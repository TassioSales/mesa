// Command mesa is the sync server: it stores each board's operation log,
// relays operations between connected clients and serves the app.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"time"

	"mesa/internal/hub"
	"mesa/internal/server"
	"mesa/internal/store"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:7979", "endereço HTTP")
	data := flag.String("data", "data/mesa.db", "arquivo SQLite com os logs de operações")
	flag.Usage = func() {
		fmt.Fprintln(os.Stderr, "mesa — servidor de sincronização local-first\n\nuso: mesa [-addr 127.0.0.1:7979] [-data data/mesa.db]")
		flag.PrintDefaults()
	}
	flag.Parse()
	if err := run(*addr, *data); err != nil {
		fmt.Fprintln(os.Stderr, "erro:", err)
		os.Exit(1)
	}
}

func run(addr, data string) error {
	if dir := filepath.Dir(data); dir != "." {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	st, err := store.Open(data)
	if err != nil {
		return err
	}
	defer st.Close()

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt)
	defer stop()
	srv := &http.Server{
		Addr:              addr,
		Handler:           server.Handler(st, hub.New(st)),
		ReadHeaderTimeout: 5 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		srv.Shutdown(shutdown)
	}()
	slog.Info("mesa ouvindo", "url", "http://"+addr, "dados", data)
	if err := srv.ListenAndServe(); !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
