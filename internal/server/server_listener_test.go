package server

import (
	"net"
	"testing"
	"time"
)

func TestListenForServerWaitsForExistingOwnerAndTakesOver(t *testing.T) {
	existing, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := existing.Addr().String()
	result := make(chan net.Listener, 1)
	errors := make(chan error, 1)
	go func() {
		listener, listenErr := listenForServer(address, 10*time.Millisecond)
		if listenErr != nil {
			errors <- listenErr
			return
		}
		result <- listener
	}()
	time.Sleep(30 * time.Millisecond)
	if err := existing.Close(); err != nil {
		t.Fatal(err)
	}
	select {
	case listener := <-result:
		listener.Close()
	case err := <-errors:
		t.Fatal(err)
	case <-time.After(time.Second):
		t.Fatal("replacement server did not take over the released port")
	}
}
