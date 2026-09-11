package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

const daemonStopTimeout = 10 * time.Second

type daemonOptions struct {
	Address string
	EnvFile string
	PIDFile string
	LogFile string
}

type daemonRecord struct {
	PID       int       `json:"pid"`
	Address   string    `json:"address"`
	StartedAt time.Time `json:"started_at"`
}

func startDaemon(options daemonOptions, stdout io.Writer) error {
	if record, err := readDaemonRecord(options.PIDFile); err == nil {
		if processAlive(record.PID) {
			return fmt.Errorf("Vibe Flow360 is already running in the background (pid %d)", record.PID)
		}
		_ = os.Remove(options.PIDFile)
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}

	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("find executable: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(options.LogFile), 0o700); err != nil {
		return fmt.Errorf("create daemon data directory: %w", err)
	}
	logOutput, err := os.OpenFile(options.LogFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("open daemon log: %w", err)
	}
	defer logOutput.Close()

	args := []string{"serve", "start", "--addr", options.Address, "--env-file", options.EnvFile}
	command := exec.Command(executable, args...)
	command.Stdin = nil
	command.Stdout = logOutput
	command.Stderr = logOutput
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := command.Start(); err != nil {
		return fmt.Errorf("start daemon: %w", err)
	}
	record := daemonRecord{PID: command.Process.Pid, Address: options.Address, StartedAt: time.Now().UTC()}
	if err := writeDaemonRecord(options.PIDFile, record); err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		return err
	}
	if err := command.Process.Release(); err != nil {
		_ = os.Remove(options.PIDFile)
		return fmt.Errorf("release daemon process: %w", err)
	}

	// Catch immediate startup failures while keeping startup responsive.
	time.Sleep(150 * time.Millisecond)
	if !processAlive(record.PID) {
		_ = os.Remove(options.PIDFile)
		return fmt.Errorf("daemon exited during startup; inspect %s", options.LogFile)
	}
	fmt.Fprintf(stdout, "Vibe Flow360 started in the background (pid %d)\nURL: %s\nLog: %s\n", record.PID, serverURL(options.Address), options.LogFile)
	return nil
}

func stopDaemon(pidFile string, stdout io.Writer) error {
	record, err := readDaemonRecord(pidFile)
	if errors.Is(err, os.ErrNotExist) {
		return errors.New("Vibe Flow360 is not running in the background")
	}
	if err != nil {
		return err
	}
	if !processAlive(record.PID) {
		_ = os.Remove(pidFile)
		return fmt.Errorf("removed stale PID file for process %d; Vibe Flow360 was not running", record.PID)
	}
	process, err := os.FindProcess(record.PID)
	if err != nil {
		return fmt.Errorf("find daemon process %d: %w", record.PID, err)
	}
	if err := process.Signal(syscall.SIGTERM); err != nil {
		return fmt.Errorf("stop daemon process %d: %w", record.PID, err)
	}
	deadline := time.Now().Add(daemonStopTimeout)
	for processAlive(record.PID) && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	if processAlive(record.PID) {
		return fmt.Errorf("daemon process %d did not stop within %s", record.PID, daemonStopTimeout)
	}
	if err := os.Remove(pidFile); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("remove PID file: %w", err)
	}
	fmt.Fprintf(stdout, "Vibe Flow360 stopped (pid %d)\n", record.PID)
	return nil
}

func stopDaemonIfRunning(pidFile string, stdout io.Writer) error {
	if _, err := os.Stat(pidFile); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return fmt.Errorf("inspect PID file: %w", err)
	}
	return stopDaemon(pidFile, stdout)
}

func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = process.Signal(syscall.Signal(0))
	return err == nil || errors.Is(err, os.ErrPermission)
}

func readDaemonRecord(path string) (daemonRecord, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return daemonRecord{}, err
	}
	var record daemonRecord
	if err := json.Unmarshal(data, &record); err != nil || record.PID <= 0 {
		return daemonRecord{}, fmt.Errorf("invalid daemon PID file %s", path)
	}
	return record, nil
}

func writeDaemonRecord(path string, record daemonRecord) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return fmt.Errorf("create PID directory: %w", err)
	}
	data, err := json.MarshalIndent(record, "", "  ")
	if err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, append(data, '\n'), 0o600); err != nil {
		return fmt.Errorf("write PID file: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("install PID file: %w", err)
	}
	return nil
}
