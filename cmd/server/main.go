package main

import (
	"flag"
	"log"

	"github.com/sunjuzhong/vibe-flow360/internal/config"
	"github.com/sunjuzhong/vibe-flow360/internal/server"
)

func main() {
	addr := flag.String("addr", ":9292", "HTTP listen address")
	flag.Parse()

	if err := config.LoadDotEnv(".env"); err != nil {
		log.Fatalf("load .env: %v", err)
	}

	app := server.New()
	log.Printf("Vibe Flow360 is available at http://localhost%s", *addr)
	if err := app.Run(*addr); err != nil {
		log.Fatal(err)
	}
}
