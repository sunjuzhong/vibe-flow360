package main

import (
	"fmt"
	"os"
)

func main() {
	if err := runCLI(os.Args[1:], os.Stdin, os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
}
