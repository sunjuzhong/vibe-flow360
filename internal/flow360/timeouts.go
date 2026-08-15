package flow360

import (
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultCommandTimeout  = 20 * time.Second
	defaultResourceTimeout = 30 * time.Minute
	defaultResourceRetries = 3
)

func timeoutFromEnv(name string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	seconds, err := strconv.Atoi(raw)
	if err != nil || seconds <= 0 {
		return fallback
	}
	return time.Duration(seconds) * time.Second
}

func intFromEnv(name string, fallback, minimum, maximum int) int {
	value, err := strconv.Atoi(strings.TrimSpace(os.Getenv(name)))
	if err != nil || value < minimum || value > maximum {
		return fallback
	}
	return value
}

func (c *Client) resourceRetryCount() int {
	if c.ResourceRetries < 0 {
		return 0
	}
	if c.ResourceRetries > 0 {
		return c.ResourceRetries
	}
	return defaultResourceRetries
}

func (c *Client) commandTimeout() time.Duration {
	if c.Timeout > 0 {
		return c.Timeout
	}
	return defaultCommandTimeout
}

func (c *Client) resourceCommandTimeout() time.Duration {
	if c.ResourceTimeout > 0 {
		return c.ResourceTimeout
	}
	if c.Timeout > 0 {
		return c.Timeout
	}
	return defaultResourceTimeout
}
