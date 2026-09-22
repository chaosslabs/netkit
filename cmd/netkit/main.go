package main

import (
	"flag"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"github.com/biancarosa/netkit/internal/proxy"
)

func main() {
	// Parse command
	if len(os.Args) < 2 {
		log.Fatal("Please specify a command: serve, request, ca, or alerts")
	}

	command := os.Args[1]
	os.Args = os.Args[1:] // Remove command from args for flag parsing

	switch command {
	case "alerts":
		if err := runAlerts(os.Args[1:]); err != nil {
			log.Fatal(err)
		}
	case "ca":
		if err := runCA(os.Args[1:]); err != nil {
			log.Fatal(err)
		}
	case "serve":
		runServe()
	case "request":
		if err := runRequest(); err != nil {
			log.Fatal(err)
		}
	default:
		log.Fatalf("Unknown command: %s. Use 'serve', 'request', 'ca', or 'alerts'", command)
	}
}

func runServe() {
	// Parse command line flags
	port := flag.Int("port", 8080, "Port to listen on")
	adminPort := flag.Int("admin-port", 8081, "Admin port for health checks and metrics (0 to disable)")
	historySize := flag.Int("history-size", 1000, "Maximum number of requests to keep in history")
	dashboard := flag.Bool("dashboard", true, "Enable web dashboard")
	dashboardPort := flag.Int("dashboard-port", 3000, "Dashboard port")
	dashboardDir := flag.String("dashboard-dir", "", "Directory containing dashboard build files (optional if embedded)")
	dashboardBasePath := flag.String("dashboard-base-path", envOrDefault("NETKIT_DASHBOARD_BASE_PATH", ""), "Public dashboard URL prefix for path-based reverse proxies")
	logLevel := flag.String("log-level", "info", "Logging level (debug, info, warn, error)")
	inspectHTTPS := flag.Bool("inspect-https", false, "Decrypt and capture HTTPS for all destinations (clients must trust the CA)")
	caCert := flag.String("ca-cert", "", "Inspection CA certificate PEM file")
	caKey := flag.String("ca-key", "", "Inspection CA private key PEM file")
	inspectionTimeout := flag.Duration("inspection-response-header-timeout", 0, "Upstream response-header timeout in inspection mode (0 disables; allow for long polling)")
	redactFields := flag.String("redact-fields", "", "Comma-separated additional JSON/header field names to redact from captures")
	flag.Parse()
	if *inspectionTimeout < 0 {
		log.Fatal("--inspection-response-header-timeout must not be negative")
	}
	var ca *proxy.CertificateAuthority
	if *inspectHTTPS {
		var err error
		ca, err = proxy.LoadCA(*caCert, *caKey)
		if err != nil {
			log.Fatal(err)
		}
	} else if *caCert != "" || *caKey != "" {
		log.Fatal("--ca-cert and --ca-key require --inspect-https")
	}

	// Create proxy configuration
	config := &proxy.Config{
		InspectionResponseHeaderTimeout: *inspectionTimeout,
		InspectionCA:                    ca,
		RedactFields:                    strings.Split(*redactFields, ","),
		Port:                            *port,
		AdminPort:                       *adminPort,
		HistorySize:                     *historySize,
		Dashboard:                       *dashboard,
		DashboardPort:                   *dashboardPort,
		DashboardDir:                    *dashboardDir,
		DashboardBasePath:               *dashboardBasePath,
		LogLevel:                        *logLevel,
	}

	// Create and start proxy server
	proxyServer := proxy.New(config)

	// Handle graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	// Add debug logging for when we're about to start
	if *logLevel == "debug" {
		log.Printf("Starting proxy server on port %d", config.Port)
		if config.AdminPort > 0 {
			log.Printf("Admin endpoints will be available on port %d", config.AdminPort)
			log.Printf("Request history size: %d", config.HistorySize)
		}
		if config.Dashboard {
			log.Printf("Dashboard will be available on port %d", config.DashboardPort)
			log.Printf("Dashboard directory: %s", config.DashboardDir)
			log.Printf("Dashboard base path: %s", config.DashboardBasePath)
		}
	}

	go func() {
		if err := proxyServer.Start(); err != nil {
			log.Fatalf("Failed to start proxy server: %v", err)
		}
	}()

	log.Printf("Proxy server started on port %d", config.Port)
	if config.AdminPort > 0 {
		log.Printf("Admin server started on port %d (health: /healthz, metrics: /metrics, history: /requests)", config.AdminPort)
	}
	if config.Dashboard {
		log.Printf("Dashboard server started on port %d", config.DashboardPort)
	}

	// Wait for shutdown signal
	<-sigChan
	log.Println("Shutting down proxy server...")

	if err := proxyServer.Stop(); err != nil {
		log.Printf("Error stopping proxy server: %v", err)
	}
}

func envOrDefault(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
