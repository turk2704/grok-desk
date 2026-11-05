# grok-desk

Static iPhone web app for a PAPER Solana memecoin desk (Plan B / GitHub Pages).

## Privacy / secrecy tradeoff (read this)

Free GitHub Pages requires a **public** repository. Live desk JSON is published under `d/<DATA_PATH>/`.
That directory name **will be visible** in the public repo tree and commit history once publishing starts.
`DATA_PATH` is therefore **obscurity only**, not a secret. JSON files contain PAPER desk numbers only
(balance, activity, charts) — never API tokens, Telegram tokens, Helius keys, or VAPID private keys.

Do not commit secrets. Do not put a `d/` folder in the initial static push; the desk process publishes it.

## Open once

`https://turk2704.github.io/grok-desk/#d=<DATA_PATH>`

Then Add to Home Screen in Safari.
