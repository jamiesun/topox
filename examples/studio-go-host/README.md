# studio-go-host

A stdlib-only Go backend for the [TopoX shared studio](../../docs/embedding.md):
static studio hosting + document store (GET/PUT) + demo SSE runtime feed.
Copy the handlers into your own service — the whole protocol is three routes.

```bash
# build the studio once
(cd ../../ && npm install && npm run build -ws)

# run the host
go run . -webroot ../../apps/studio/dist
# → http://localhost:8092
```

Routes:

| Route | Purpose |
| --- | --- |
| `/studio/` | studio static files (swap for `go:embed` in production) |
| `GET/PUT /api/docs/{id}` | TopoDoc storage — JSON files with atomic writes |
| `GET /api/docs` | list document ids |
| `/stream` | demo `RuntimeEvent` SSE feed (replace with real telemetry) |

Editing link your app renders:

```
/studio/?src=/api/docs/edge-pop&ret=/your/page
```

Same-origin means no CORS and session cookies flow into `src`/`save` requests
automatically — add your normal auth middleware around `/api/docs/`.

To embed the studio into a single binary, copy `apps/studio/dist` into the
package and swap the file server for:

```go
//go:embed dist
var studioFS embed.FS
sub, _ := fs.Sub(studioFS, "dist")
mux.Handle("/studio/", http.StripPrefix("/studio/", http.FileServer(http.FS(sub))))
```
