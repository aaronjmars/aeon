---
name: Benign Cmd Sub
---
```bash
FROM_DATE=$(echo "$TIME_WINDOW" | cut -d: -f1)
DAYS=$(echo "$TIME_WINDOW" | sed 's/[^0-9]//g')
```
