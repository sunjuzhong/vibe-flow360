package knowledge

import (
	"hash/fnv"
	"math"
	"strings"
	"unicode"
)

// LocalEmbedder provides deterministic, dependency-free semantic-ish vectors.
// It is intentionally simple: tokens and adjacent rune pairs are hashed into a
// fixed vector. Hosted embeddings remain available for higher recall.
type LocalEmbedder struct{}

func NewLocalEmbedder() *LocalEmbedder { return &LocalEmbedder{} }
func (*LocalEmbedder) Ready() bool     { return true }

func (*LocalEmbedder) GenerateEmbedding(text string) ([]float32, error) {
	vector := make([]float32, localEmbeddingSize)
	words := strings.FieldsFunc(strings.ToLower(text), func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsNumber(r)
	})
	for _, word := range words {
		addHashedFeature(vector, "w:"+word, 1)
		runes := []rune(word)
		for i := 0; i+1 < len(runes); i++ {
			addHashedFeature(vector, "r:"+string(runes[i:i+2]), 0.5)
		}
	}
	var norm float64
	for _, value := range vector {
		norm += float64(value * value)
	}
	if norm > 0 {
		scale := float32(1 / math.Sqrt(norm))
		for i := range vector {
			vector[i] *= scale
		}
	}
	return vector, nil
}

func addHashedFeature(vector []float32, feature string, weight float32) {
	hasher := fnv.New64a()
	_, _ = hasher.Write([]byte(feature))
	hash := hasher.Sum64()
	index := int(hash % uint64(len(vector)))
	if hash&(1<<63) != 0 {
		weight = -weight
	}
	vector[index] += weight
}
