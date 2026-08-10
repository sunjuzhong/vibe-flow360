package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/sunjuzhong/vibe-flow360/internal/agent"
)

func TestInterpretResultUsesBoundedWholeTableSummary(t *testing.T) {
	gin.SetMode(gin.TestMode)
	var providerBody string
	providerCalls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		providerCalls++
		data, _ := io.ReadAll(r.Body)
		providerBody = string(data)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":"## Overview\nResiduals decrease."}}]}`))
	}))
	defer provider.Close()
	storeDir := t.TempDir()
	store, err := newResultInterpretationStore(storeDir)
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{agent: &agent.Service{Provider: "builtin", APIKey: "test", BaseURL: provider.URL, Model: "test", Client: provider.Client()}, resultAI: store}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/agent/interpret-result", strings.NewReader(`{
	  "scope":"project-1:Case:case-1","path":"results/nonlinear_residual_v2.csv","fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","language":"zh-CN","total_rows":4000,"delimiter":"comma",
	  "columns":[
	    {"field":"physical_step","kind":"numeric","count":4000,"missing":0,"unique":4,"minimum":1,"maximum":4,"mean":2.5},
	    {"field":"pseudo_step","kind":"numeric","count":4000,"missing":0,"unique":1000,"minimum":1,"maximum":1000,"mean":500.5},
	    {"field":"0_cont","kind":"numeric","count":4000,"missing":0,"unique":4000,"minimum":1e-8,"maximum":1e-2,"mean":1e-4},
	    {"field":"1_momx","kind":"numeric","count":4000,"missing":0,"unique":4000,"minimum":1e-8,"maximum":1e-2,"mean":1e-4}
	  ],
	  "sample_rows":[{"physical_step":"1","pseudo_step":"1","0_cont":"0.01","1_momx":"0.01"},{"physical_step":"4","pseudo_step":"1000","0_cont":"1e-8","1_momx":"1e-8"}]
	}`))
	context.Request.Header.Set("Content-Type", "application/json")

	app.interpretResult(context)

	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "Residuals decrease") {
		t.Fatalf("unexpected response %d: %s", recorder.Code, recorder.Body.String())
	}
	if providerCalls != 1 || !strings.Contains(recorder.Body.String(), `"cached":false`) {
		t.Fatalf("first interpretation should call the provider once: calls=%d body=%s", providerCalls, recorder.Body.String())
	}
	for _, expected := range []string{
		`4000`, `Simplified Chinese`, `Field dictionary`, `EVERY supplied field`,
		`continuity/mass-conservation`, `momentum equation residuals`, `per-step pseudo-convergence`,
		`nonlinear_residual_v2.csv`, `0_cont`, `1_momx`,
	} {
		if !strings.Contains(providerBody, expected) {
			t.Fatalf("provider prompt is missing %q: %s", expected, providerBody)
		}
	}

	// A new store instance proves the cached interpretation survives process restart.
	reopenedStore, err := newResultInterpretationStore(storeDir)
	if err != nil {
		t.Fatal(err)
	}
	app.resultAI = reopenedStore
	cachedRecorder := httptest.NewRecorder()
	cachedContext, _ := gin.CreateTestContext(cachedRecorder)
	cachedContext.Request = httptest.NewRequest(http.MethodPost, "/api/agent/interpret-result", strings.NewReader(`{
	  "scope":"project-1:Case:case-1","path":"results/nonlinear_residual_v2.csv","fingerprint":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","language":"zh-CN","total_rows":4000,"delimiter":"comma",
	  "columns":[
	    {"field":"physical_step","kind":"numeric","count":4000,"missing":0,"unique":4,"minimum":1,"maximum":4,"mean":2.5},
	    {"field":"pseudo_step","kind":"numeric","count":4000,"missing":0,"unique":1000,"minimum":1,"maximum":1000,"mean":500.5},
	    {"field":"0_cont","kind":"numeric","count":4000,"missing":0,"unique":4000,"minimum":1e-8,"maximum":1e-2,"mean":1e-4},
	    {"field":"1_momx","kind":"numeric","count":4000,"missing":0,"unique":4000,"minimum":1e-8,"maximum":1e-2,"mean":1e-4}
	  ],
	  "sample_rows":[{"physical_step":"1","pseudo_step":"1","0_cont":"0.01","1_momx":"0.01"},{"physical_step":"4","pseudo_step":"1000","0_cont":"1e-8","1_momx":"1e-8"}]
	}`))
	cachedContext.Request.Header.Set("Content-Type", "application/json")
	app.interpretResult(cachedContext)
	if cachedRecorder.Code != http.StatusOK || !strings.Contains(cachedRecorder.Body.String(), `"cached":true`) || providerCalls != 1 {
		t.Fatalf("cached interpretation called provider: calls=%d status=%d body=%s", providerCalls, cachedRecorder.Code, cachedRecorder.Body.String())
	}
}

func TestInterpretResultConversationPersistsAndCanBeCleared(t *testing.T) {
	gin.SetMode(gin.TestMode)
	providerCalls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		providerCalls++
		content := "## Base\nContinuity residual falls."
		if providerCalls > 1 {
			content = "The momentum plateau should be checked against force history."
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"role":"assistant","content":` + strconv.Quote(content) + `}}]}`))
	}))
	defer provider.Close()
	store, err := newResultInterpretationStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	app := &Server{agent: &agent.Service{Provider: "builtin", APIKey: "test", BaseURL: provider.URL, Model: "test", Client: provider.Client()}, resultAI: store}
	base := `"scope":"project-1:Case:case-1","path":"results/residual.csv","fingerprint":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","language":"en","total_rows":2,"delimiter":"comma","columns":[{"field":"0_cont","kind":"numeric","count":2,"missing":0,"unique":2}],"sample_rows":[{"0_cont":"1"},{"0_cont":"0.1"}]`
	call := func(extra string) *httptest.ResponseRecorder {
		recorder := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(recorder)
		body := "{" + base
		if extra != "" {
			body += "," + extra
		}
		body += "}"
		context.Request = httptest.NewRequest(http.MethodPost, "/api/agent/interpret-result", strings.NewReader(body))
		context.Request.Header.Set("Content-Type", "application/json")
		app.interpretResult(context)
		return recorder
	}

	if recorder := call(""); recorder.Code != http.StatusOK {
		t.Fatalf("base generation failed: %d %s", recorder.Code, recorder.Body.String())
	}
	asked := call(`"mode":"ask","question":"Why did momentum plateau?"`)
	if asked.Code != http.StatusOK || !strings.Contains(asked.Body.String(), "Why did momentum plateau?") || !strings.Contains(asked.Body.String(), "force history") {
		t.Fatalf("follow-up failed: %d %s", asked.Code, asked.Body.String())
	}
	if providerCalls != 2 {
		t.Fatalf("got %d provider calls, want base + follow-up", providerCalls)
	}
	cleared := call(`"mode":"clear"`)
	if cleared.Code != http.StatusOK || !strings.Contains(cleared.Body.String(), `"messages":[]`) || providerCalls != 2 {
		t.Fatalf("clear should preserve base without provider call: calls=%d status=%d body=%s", providerCalls, cleared.Code, cleared.Body.String())
	}
	regenerated := call(`"mode":"regenerate"`)
	if regenerated.Code != http.StatusOK || !strings.Contains(regenerated.Body.String(), `"messages":[]`) || providerCalls != 3 {
		t.Fatalf("regenerate should replace base and reset conversation: calls=%d status=%d body=%s", providerCalls, regenerated.Code, regenerated.Body.String())
	}
}

func TestInterpretResultRequiresConfiguredProvider(t *testing.T) {
	gin.SetMode(gin.TestMode)
	app := &Server{agent: &agent.Service{Provider: "builtin"}}
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)
	context.Request = httptest.NewRequest(http.MethodPost, "/api/agent/interpret-result", strings.NewReader(`{}`))

	app.interpretResult(context)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("got status %d, want 503", recorder.Code)
	}
}

func TestResultInterpretationCacheKeyTracksDataLanguageAndModelButNotConversation(t *testing.T) {
	request := resultInterpretationRequest{
		Scope: "project-1:Case:case-1", Path: "results/residual.csv", Fingerprint: strings.Repeat("a", 64), Language: "en",
		TotalRows: 1, Delimiter: "comma", Columns: []resultColumnSummary{{Field: "0_cont", Kind: "numeric", Count: 1}},
	}
	state := agent.State{Provider: "builtin", Model: "model-a"}
	base, err := resultInterpretationCacheKey(request, state)
	if err != nil {
		t.Fatal(err)
	}
	conversation := request
	conversation.Mode = "ask"
	conversation.Question = "Why?"
	same, _ := resultInterpretationCacheKey(conversation, state)
	if same != base {
		t.Fatal("conversation fields changed the dataset cache key")
	}
	variants := []struct {
		request resultInterpretationRequest
		state   agent.State
	}{
		{request: func() resultInterpretationRequest {
			value := request
			value.Fingerprint = strings.Repeat("b", 64)
			return value
		}(), state: state},
		{request: func() resultInterpretationRequest { value := request; value.Language = "zh-CN"; return value }(), state: state},
		{request: request, state: agent.State{Provider: "builtin", Model: "model-b"}},
		{request: func() resultInterpretationRequest {
			value := request
			value.Scope = "project-2:Case:case-2"
			return value
		}(), state: state},
	}
	for _, variant := range variants {
		key, err := resultInterpretationCacheKey(variant.request, variant.state)
		if err != nil {
			t.Fatal(err)
		}
		if key == base {
			t.Fatal("data, language, or model change did not invalidate the cache key")
		}
	}
}
