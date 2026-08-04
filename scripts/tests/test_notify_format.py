#!/usr/bin/env python3
"""Local tests for notify_format. Run: python3 scripts/tests/test_notify_format.py"""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import notify_format as nf  # noqa: E402


def fences_balanced(s: str) -> bool:
    return nf._fence_count(s) % 2 == 0


class TestChunk(unittest.TestCase):
    def test_short_text_single_chunk_unchanged(self):
        self.assertEqual(nf.chunk("hello world", 3900), ["hello world"])

    def test_empty(self):
        self.assertEqual(nf.chunk("", 3900), [])
        self.assertEqual(nf.chunk("\n\n", 3900), [])

    def test_all_chunks_within_limit(self):
        text = "\n\n".join(f"para {i} " + "x" * 200 for i in range(50))
        for c in nf.chunk(text, 500):
            self.assertLessEqual(len(c), 500, f"chunk over limit: {len(c)}")

    def test_long_single_paragraph_hard_split(self):
        text = "y" * 5000
        chunks = nf.chunk(text, 1000)
        self.assertTrue(len(chunks) >= 5)
        for c in chunks:
            self.assertLessEqual(len(c), 1000)

    def test_never_splits_inside_fence(self):
        # a code block big enough to force a split must stay balanced per-chunk
        code = "```python\n" + "\n".join(f"line_{i} = {i}" for i in range(400)) + "\n```"
        text = "intro paragraph\n\n" + code + "\n\noutro paragraph"
        chunks = nf.chunk(text, 600)
        self.assertGreater(len(chunks), 1)
        for c in chunks:
            self.assertLessEqual(len(c), 600)
            self.assertTrue(fences_balanced(c), f"unbalanced fence in chunk:\n{c}")

    def test_reassembly_preserves_payload(self):
        # stripping rebalance fences + footers, the content survives a round trip
        text = "alpha\n\nbravo\n\ncharlie " + "z" * 1200
        chunks = nf.chunk(text, 400)
        joined = "".join(chunks).replace("```", "")
        for token in ("alpha", "bravo", "charlie"):
            self.assertIn(token, joined)


def no_unescaped_angle_outside_tags(s: str) -> bool:
    """True if every < / > in s belongs to a tag we emit (never a raw literal)."""
    # Remove all well-formed tags, then assert no stray < or > remain.
    stripped = nf.re.sub(r"</?[a-zA-Z][^>]*>", "", s)
    return "<" not in stripped and ">" not in stripped


class TestTelegramHtml(unittest.TestCase):
    def test_bold_double_star_becomes_b_tag(self):
        self.assertEqual(nf.md_to_telegram_html("**hi**"), "<b>hi</b>")
        self.assertEqual(nf.md_to_telegram_html("__hi__"), "<b>hi</b>")

    def test_heading_becomes_bold(self):
        self.assertEqual(nf.md_to_telegram_html("## Token Report"), "<b>Token Report</b>")

    def test_bullets_become_dots(self):
        self.assertEqual(nf.md_to_telegram_html("- one\n- two"), "• one\n• two")

    def test_link_preserved_as_anchor(self):
        out = nf.md_to_telegram_html("see [chart](https://x.com/foo)")
        self.assertIn('<a href="https://x.com/foo">chart</a>', out)

    def test_inline_code_escaped(self):
        out = nf.md_to_telegram_html("run `a < b && c`")
        self.assertIn("<code>a &lt; b &amp;&amp; c</code>", out)

    def test_angle_brackets_in_prose_escaped(self):
        out = nf.md_to_telegram_html("use <script> & stay safe")
        self.assertNotIn("<script>", out)
        self.assertIn("&lt;script&gt;", out)
        self.assertIn("&amp;", out)

    def test_table_flattened_with_bold_header(self):
        md = "| Asset | 24h |\n| --- | --- |\n| BTC | +3.2% |"
        out = nf.md_to_telegram_html(md)
        self.assertIn("<b>Asset</b> | <b>24h</b>", out)
        self.assertIn("BTC | +3.2%", out)
        self.assertNotIn("---", out)

    def test_fenced_code_becomes_pre(self):
        out = nf.md_to_telegram_html("```py\nx = 1 < 2\n```")
        self.assertIn('<pre><code class="language-py">x = 1 &lt; 2</code></pre>', out)

    def test_unbalanced_marker_stays_literal_and_safe(self):
        # a lone * must not open a tag or produce invalid HTML
        out = nf.md_to_telegram_html("price is 3 * 4 and *incomplete")
        self.assertTrue(no_unescaped_angle_outside_tags(out))
        self.assertNotIn("<i>", out)

    def test_snake_case_not_italicized(self):
        self.assertEqual(nf.md_to_telegram_html("call some_func_name now"),
                         "call some_func_name now")

    def test_realistic_body_is_valid_html(self):
        body = ("## Report\n\n**Verdict:** up\n\n- BTC **+3.2%** to `$68,400`\n"
                "- see [x](https://x.com/a?b=1&c=2)\n\n| A | B |\n| - | - |\n| 1 | 2 |")
        for c in nf.telegram(body, title="Daily", severity="info"):
            self.assertTrue(no_unescaped_angle_outside_tags(c), f"stray < or >:\n{c}")


class TestChannels(unittest.TestCase):
    def test_telegram_adds_index_suffix_when_split(self):
        chunks = nf.telegram("p\n\n" + "x" * 9000, title="", severity="info", limit=3900)
        self.assertGreater(len(chunks), 1)
        self.assertIn("[1/", chunks[0])
        for c in chunks:
            self.assertLessEqual(len(c), 3900)

    def test_telegram_title_prefix(self):
        chunks = nf.telegram("body", title="Token Report", severity="warn")
        self.assertIn("Token Report", chunks[0])
        self.assertIn("⚠️", chunks[0])
        self.assertIn("<b>", chunks[0])

    def test_discord_returns_embeds_with_color(self):
        payloads = nf.discord("body text", title="Alert", severity="critical")
        self.assertEqual(len(payloads), 1)
        embed = payloads[0]["embeds"][0]
        self.assertEqual(embed["color"], nf.SEVERITY["critical"]["color"])
        self.assertIn("Alert", embed["title"])
        self.assertEqual(embed["description"], "body text")

    def test_discord_chunks_long_body_into_multiple_embeds(self):
        payloads = nf.discord("z" * 9000, title="X", severity="info", limit=4096)
        self.assertGreater(len(payloads), 1)
        for p in payloads:
            self.assertLessEqual(len(p["embeds"][0]["description"]), 4096)
        # title only on first embed
        self.assertIn("title", payloads[0]["embeds"][0])
        self.assertNotIn("title", payloads[1]["embeds"][0])

    def test_slack_block_kit_shape(self):
        payload = nf.slack("body", title="Heads up", severity="info")
        self.assertEqual(payload["blocks"][0]["type"], "header")
        self.assertEqual(payload["blocks"][1]["type"], "section")
        self.assertEqual(payload["blocks"][1]["text"]["type"], "mrkdwn")

    def test_slack_sections_within_limit(self):
        payload = nf.slack("z" * 9000, title="", severity="info", limit=3000)
        for b in payload["blocks"]:
            if b["type"] == "section":
                self.assertLessEqual(len(b["text"]["text"]), 3000)

    def test_buzz_returns_raw_markdown_with_title(self):
        chunks = nf.buzz("- a bullet\n- another", title="Daily", severity="warn")
        self.assertEqual(len(chunks), 1)
        # Markdown is passed through untouched (Buzz renders it natively); title is bolded.
        self.assertIn("**Daily**", chunks[0])
        self.assertIn("- a bullet", chunks[0])

    def test_buzz_chunks_within_limit_and_indexes(self):
        chunks = nf.buzz("z" * 40000, title="", severity="info", limit=15000)
        self.assertGreater(len(chunks), 1)
        n = len(chunks)
        for i, c in enumerate(chunks):
            self.assertLessEqual(len(c), 15000)
            self.assertTrue(c.rstrip().endswith(f"[{i + 1}/{n}]"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
