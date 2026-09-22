package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/biancarosa/netkit/internal/alerting"
)

func runAlerts(args []string) error {
	flags := flag.NewFlagSet("alerts", flag.ContinueOnError)
	listen := flags.String("listen", "127.0.0.1:8090", "Incident receiver address; protect with authenticated ingress before exposing")
	dir := flags.String("dir", "", "Private incident directory (required)")
	admin := flags.String("admin-url", "http://127.0.0.1:8081", "Fixed Netkit admin URL for metadata evidence")
	dashboard := flags.String("dashboard-url", "http://127.0.0.1:3000", "Public Netkit dashboard URL including any prefix")
	instance := flags.String("instance", "netkit-local", "Expected Prometheus instance alias")
	capacity := flags.Int("capacity", 100, "Maximum stored incidents (1–1000)")
	ttl := flags.Duration("retention", 7*24*time.Hour, "Incident retention (1 minute–30 days)")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if *dir == "" {
		return fmt.Errorf("--dir is required")
	}
	receiver, err := alerting.New(alerting.Config{Dir: *dir, Token: os.Getenv("NETKIT_ALERT_TOKEN"), Instance: *instance, AdminURL: *admin, DashboardURL: *dashboard, Capacity: *capacity, TTL: *ttl})
	if err != nil {
		return err
	}
	if err := receiver.Prune(); err != nil {
		return err
	}
	server := &http.Server{Addr: *listen, Handler: receiver.Handler(), ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 45 * time.Second, IdleTimeout: 30 * time.Second}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
				_ = server.Shutdown(shutdown)
				cancel()
				return
			case <-ticker.C:
				if err := receiver.Prune(); err != nil {
					log.Print("incident retention maintenance failed; check private storage")
				}
			}
		}
	}()
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}
