// studio-go-host: a stdlib-only Go backend for the TopoX shared studio.
//
//	go run . -webroot ../../apps/studio/dist
//
// It serves:
//
//	/studio/            the studio static build (or go:embed it in your app)
//	/api/docs/{id}      GET returns a TopoDoc, PUT stores one (atomic write)
//	/api/docs           GET lists stored document ids
//	/stream             demo SSE feed of RuntimeEvent JSON (replace with real data)
//	/                   a tiny index linking into the studio
//
// Editing link format (see docs/embedding.md):
//
//	/studio/?src=/api/docs/edge-pop&ret=/
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

var idPattern = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,64}$`)

type docStore struct{ dir string }

func (s docStore) path(id string) string { return filepath.Join(s.dir, id+".json") }

func (s docStore) get(w http.ResponseWriter, r *http.Request, id string) {
	data, err := os.ReadFile(s.path(id))
	if os.IsNotExist(err) {
		http.Error(w, "document not found", http.StatusNotFound)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(data)
}

func (s docStore) put(w http.ResponseWriter, r *http.Request, id string) {
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 16<<20))
	if err != nil {
		http.Error(w, err.Error(), http.StatusRequestEntityTooLarge)
		return
	}
	// Shape check: a TopoDoc is { graph, views }. Full validation can be
	// added by round-tripping through @topox/core in CI, or a Go schema.
	var probe struct {
		Graph json.RawMessage `json:"graph"`
		Views json.RawMessage `json:"views"`
	}
	if err := json.Unmarshal(body, &probe); err != nil || probe.Graph == nil || probe.Views == nil {
		http.Error(w, "expected a TopoDoc: { graph, views }", http.StatusBadRequest)
		return
	}
	tmp, err := os.CreateTemp(s.dir, ".doc-*")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(body); err != nil {
		tmp.Close()
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	tmp.Close()
	if err := os.Rename(tmp.Name(), s.path(id)); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s docStore) list(w http.ResponseWriter) {
	entries, _ := os.ReadDir(s.dir)
	ids := []string{}
	for _, e := range entries {
		if name, ok := strings.CutSuffix(e.Name(), ".json"); ok {
			ids = append(ids, name)
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(ids)
}

// streamSSE emits demo RuntimeEvents. In production, publish real status and
// metrics keyed by Node.ref: snapshot first, then node/edge patches.
func streamSSE(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")

	refs := []string{"dev:fw-01", "dev:core-01", "dev:sw-01", "svc:acs", "cpe:1001", "cpe:1002"}
	statuses := []string{"running", "running", "running", "waiting", "error", "offline"}

	nodes := map[string]any{}
	for _, ref := range refs {
		nodes[ref] = map[string]any{"status": "running", "metrics": map[string]any{"cpu": rand.Intn(90)}}
	}
	send := func(event any) bool {
		data, _ := json.Marshal(event)
		if _, err := fmt.Fprintf(w, "data: %s\n\n", data); err != nil {
			return false
		}
		flusher.Flush()
		return true
	}
	if !send(map[string]any{
		"kind": "snapshot", "ts": time.Now().UnixMilli(),
		"state": map[string]any{"nodes": nodes, "edges": map[string]any{}},
	}) {
		return
	}
	ticker := time.NewTicker(1500 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			ok := send(map[string]any{
				"kind": "node", "key": refs[rand.Intn(len(refs))], "ts": time.Now().UnixMilli(),
				"patch": map[string]any{
					"status":  statuses[rand.Intn(len(statuses))],
					"metrics": map[string]any{"cpu": rand.Intn(95), "latency": rand.Intn(300)},
				},
			})
			if !ok {
				return
			}
		}
	}
}

const indexHTML = `<!doctype html><meta charset="utf-8"><title>studio-go-host</title>
<body style="font:14px system-ui;max-width:640px;margin:40px auto">
<h2>TopoX studio-go-host</h2>
<ul>
<li><a href="/studio/?src=/api/docs/edge-pop&ret=/">edit "edge-pop" in the studio</a></li>
<li><a href="/api/docs">list documents</a></li>
<li><code>curl -N localhost%s/stream</code> — demo RuntimeEvent SSE feed</li>
</ul>`

func main() {
	addr := flag.String("addr", ":8092", "listen address")
	webroot := flag.String("webroot", "../../apps/studio/dist", "studio static build directory")
	dataDir := flag.String("data", "./data", "document storage directory")
	flag.Parse()

	if err := os.MkdirAll(*dataDir, 0o755); err != nil {
		log.Fatal(err)
	}
	store := docStore{dir: *dataDir}

	mux := http.NewServeMux()
	mux.Handle("/studio/", http.StripPrefix("/studio/", http.FileServer(http.Dir(*webroot))))
	mux.HandleFunc("/api/docs", func(w http.ResponseWriter, r *http.Request) { store.list(w) })
	mux.HandleFunc("/api/docs/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/docs/")
		if !idPattern.MatchString(id) {
			http.Error(w, "invalid document id", http.StatusBadRequest)
			return
		}
		switch r.Method {
		case http.MethodGet:
			store.get(w, r, id)
		case http.MethodPut:
			store.put(w, r, id)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})
	mux.HandleFunc("/stream", streamSSE)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html")
		fmt.Fprintf(w, indexHTML, *addr)
	})

	log.Printf("studio-go-host → http://localhost%s (webroot=%s data=%s)", *addr, *webroot, *dataDir)
	log.Fatal(http.ListenAndServe(*addr, mux))
}
