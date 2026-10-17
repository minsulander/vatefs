# VatIRIS PR package — EFS sync

See [../README.md](../README.md) for the **single allowed write set**.

| Method | Path |
|--------|------|
| PUT/DELETE | `/:realm/:airport/:stripKey` |
| PUT | `/:realm/:airport/order` |
| PUT/GET | `/:realm/:airport/meta` |
| PUT | `/:realm/:airport/heartbeat` (optional) |
| WS | `/:realm/:airport/ws?cid=` |

Not used: `/sep`, `/strips/:stripKey`, `PUT /efs/:airport/:view`.
