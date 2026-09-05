"""Contract checks, not a claim that a model followed the reporting instructions."""
from pathlib import Path
import unittest
import subprocess
import tempfile

SKILL = (Path(__file__).resolve().parents[2] / "skills/vuln-scanner/SKILL.md").read_text()


class ScannerStatusContract(unittest.TestCase):
    def test_history_status_uses_exit_code_not_finding_count(self):
        block = SKILL.split('if [ "${TRUFFLEHOG_GIT_RC:-1}"', 1)[1].split('\necho "osv=', 1)[0]
        block = 'if [ "${TRUFFLEHOG_GIT_RC:-1}"' + block
        with tempfile.TemporaryDirectory() as directory:
            # Partial findings must not turn a later process failure into ok.
            (Path(directory) / "trufflehog-git.json").write_text('{}\n')
            for rc, expected in [(0, "ok"), (1, "fail"), (124, "timeout"), (137, "fail")]:
                with self.subTest(rc=rc):
                    # Execute the actual status block with partial findings.
                    script = block.replace("/tmp/vuln-scan", directory)
                    result = subprocess.run(["bash", "-c", f"TRUFFLEHOG_GIT_RC={rc}\n{script}"], check=True)
                    self.assertEqual(result.returncode, 0)
                    rows = (Path(directory) / "sources.txt").read_text().splitlines()
                    self.assertEqual(rows[-1], f"trufflehog-git={expected}")

    def test_filesystem_clean_empty_stream_is_ok(self):
        row = next(line for line in SKILL.splitlines() if line.startswith('echo "trufflehog='))
        with tempfile.TemporaryDirectory() as directory:
            for rc, expected in [(0, "ok"), (1, "fail")]:
                subprocess.run(["bash", "-c", f"TRUFFLEHOG_RC={rc}\n" + row.replace("/tmp/vuln-scan", directory)], check=True)
                self.assertEqual((Path(directory) / "sources.txt").read_text().splitlines()[-1], f"trufflehog={expected}")

    def test_report_preserves_history_status(self):
        report = SKILL.split("### A7. Write local report", 1)[1].split("### A8.", 1)[0]
        self.assertIn("trufflehog-git", report)
        self.assertIn("sources.txt", report)

    def test_both_notification_templates_preserve_history_status(self):
        notify = SKILL.split("### A8. Notify", 1)[1].split("## Arm D", 1)[0]
        rows = [line for line in notify.splitlines() if "Scanners:" in line]
        self.assertEqual(len(rows), 2)
        for row in rows:
            self.assertIn("trufflehog-git=<ok|fail|timeout>", row)

    def test_log_preserves_history_status(self):
        log = SKILL.split("## Log", 1)[1].split("## Network note", 1)[0]
        self.assertIn("trufflehog-git=ok|fail|timeout", log)


if __name__ == "__main__":
    unittest.main()
