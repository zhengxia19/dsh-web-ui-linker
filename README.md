# dsh-web-ui-linker

A tiny [DeepSeek Harness](https://github.com/deepseek-ai) (dsh) host plugin with one job: on every dsh
boot, ask this instance's own `connection` service for its browser-authenticated Web UI link
(`connection.authenticatedUrl(cleanBaseUrl)`) and write it to a fixed file, overwriting the previous one.

Read-only by design — it registers no routes, touches no authentication, and calls nothing that could
restart or interrupt the instance.

## Output

| File | Content |
| --- | --- |
| `web-ui-url.txt` | The authenticated URL, plus a comment with the write time, pid, and the clean origin |
| `web-ui-url.status.txt` | Diagnostics trail, so a failure is distinguishable from an unmounted plugin |

Both files are runtime artifacts and are gitignored — `web-ui-url.txt` contains a live session token.

## How it works

Shipped host plugins never subscribe to a `ready` event, and the listener binds its port during
application start rather than during plugin `apply`. So the write is driven by a plain poll loop:
wait until `webServer.port` resolves, write the link as soon as it is available, then keep the file
fresh for a short while in case the port changes.

## Usage

Bundle it into a dsh profile through its patch entry (`cordis.patch.yml`):

```json
{
  "dsh": {
    "bundle": {
      "patch": "./cordis.patch.yml"
    }
  }
}
```

Requires Node.js >= 22. MIT licensed.
