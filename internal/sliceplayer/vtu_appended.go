package sliceplayer

import (
	"bufio"
	"bytes"
	"compress/zlib"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const (
	vtkMarkupScanLimit     = int64(1 << 20)
	maxVTKCompressedBlocks = uint64(1 << 20)
)

// vtkBase64QuantumReader accepts VTK's concatenated, individually padded base64 blocks.
type vtkBase64QuantumReader struct {
	source  *bufio.Reader
	decoded []byte
	err     error
}

func (r *vtkBase64QuantumReader) Read(target []byte) (int, error) {
	for len(r.decoded) == 0 && r.err == nil {
		quartet := [4]byte{}
		count := 0
		for count < len(quartet) {
			value, err := r.source.ReadByte()
			if err != nil {
				r.err = err
				break
			}
			if value == ' ' || value == '\n' || value == '\r' || value == '\t' {
				continue
			}
			quartet[count] = value
			count++
		}
		if count == 0 {
			break
		}
		if count != 4 {
			r.err = errors.New("base64 VTU payload is not aligned to quanta")
			break
		}
		decoded := [3]byte{}
		n, err := base64.StdEncoding.Decode(decoded[:], quartet[:])
		if err != nil {
			r.err = fmt.Errorf("decode base64 VTU payload: %w", err)
			break
		}
		r.decoded = append(r.decoded, decoded[:n]...)
	}
	if len(r.decoded) > 0 {
		n := copy(target, r.decoded)
		r.decoded = r.decoded[n:]
		return n, nil
	}
	return 0, r.err
}

func materializeAppendedVTK(reader *bufio.Reader, root string, arrays []streamedArray, headerBytes int, compressed bool, encoding string, cancelled func() bool) error {
	if !strings.EqualFold(encoding, "raw") && !strings.EqualFold(encoding, "base64") {
		return fmt.Errorf("unsupported appended VTU encoding %q", encoding)
	}
	spoolPath := filepath.Join(root, "appended.payload")
	spool, err := os.OpenFile(spoolPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, copyErr := copyWithCancellation(spool, reader, cancelled)
	closeErr := spool.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}

	file, err := os.Open(spoolPath)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	payloadStart, payloadEnd, err := appendedPayloadBounds(file, info.Size())
	if err != nil {
		return err
	}

	for index := range arrays {
		if arrays[index].Offset < 0 {
			continue
		}
		if cancelled != nil && cancelled() {
			return ErrCancelled
		}
		endOffset := payloadEnd - payloadStart
		for next := range arrays {
			if arrays[next].Offset > arrays[index].Offset && arrays[next].Offset < endOffset {
				endOffset = arrays[next].Offset
			}
		}
		if arrays[index].Offset >= endOffset {
			return errors.New("appended VTU array offset is outside its payload")
		}
		section := io.NewSectionReader(file, payloadStart+arrays[index].Offset, endOffset-arrays[index].Offset)
		var source io.Reader = section
		if strings.EqualFold(encoding, "base64") {
			source = &vtkBase64QuantumReader{source: bufio.NewReaderSize(section, streamBufferBytes)}
		}
		written, decodeErr := decodeVTKBlock(source, headerBytes, compressed, arrays[index].Path, cancelled)
		if decodeErr != nil {
			return fmt.Errorf("decode appended array %q: %w", arrays[index].Name, decodeErr)
		}
		arrays[index].Bytes = written
	}
	return nil
}

func appendedPayloadBounds(file *os.File, size int64) (int64, int64, error) {
	if size <= 0 {
		return 0, 0, errors.New("appended VTU payload is empty")
	}
	prefixLength := minInt64(size, vtkMarkupScanLimit)
	prefix := make([]byte, prefixLength)
	if _, err := file.ReadAt(prefix, 0); err != nil && !errors.Is(err, io.EOF) {
		return 0, 0, err
	}
	underscore := bytes.IndexByte(prefix, '_')
	if underscore < 0 {
		return 0, 0, errors.New("appended VTU payload has no underscore sentinel")
	}
	tailLength := minInt64(size, vtkMarkupScanLimit)
	tail := make([]byte, tailLength)
	if _, err := file.ReadAt(tail, size-tailLength); err != nil && !errors.Is(err, io.EOF) {
		return 0, 0, err
	}
	closing := bytes.LastIndex(tail, []byte("</AppendedData"))
	if closing < 0 {
		return 0, 0, errors.New("appended VTU payload has no closing tag")
	}
	start := int64(underscore + 1)
	end := size - tailLength + int64(closing)
	if end <= start {
		return 0, 0, errors.New("appended VTU payload is malformed")
	}
	return start, end, nil
}

func decodeCompressedInlineVTKArray(reader *bufio.Reader, headerBytes int, target string, cancelled func() bool) (int64, error) {
	encodedPath := target + ".base64"
	encoded, err := os.OpenFile(encodedPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return 0, err
	}
	defer os.Remove(encodedPath)
	for {
		if cancelled != nil && cancelled() {
			encoded.Close()
			return 0, ErrCancelled
		}
		chunk, readErr := reader.ReadSlice('<')
		hasDelimiter := readErr == nil && len(chunk) > 0 && chunk[len(chunk)-1] == '<'
		if hasDelimiter {
			chunk = chunk[:len(chunk)-1]
		}
		if _, err := encoded.Write(chunk); err != nil {
			encoded.Close()
			return 0, err
		}
		if hasDelimiter {
			closing, closeErr := reader.ReadString('>')
			if closeErr != nil {
				encoded.Close()
				return 0, closeErr
			}
			if strings.TrimSpace(closing) != "/DataArray>" {
				encoded.Close()
				return 0, errors.New("VTU DataArray has malformed closing tag")
			}
			break
		}
		if readErr != nil && !errors.Is(readErr, bufio.ErrBufferFull) {
			encoded.Close()
			return 0, readErr
		}
	}
	if err := encoded.Close(); err != nil {
		return 0, err
	}
	input, err := os.Open(encodedPath)
	if err != nil {
		return 0, err
	}
	defer input.Close()
	source := &vtkBase64QuantumReader{source: bufio.NewReaderSize(input, streamBufferBytes)}
	return decodeVTKBlock(source, headerBytes, true, target, cancelled)
}

func decodeVTKBlock(source io.Reader, headerBytes int, compressed bool, target string, cancelled func() bool) (int64, error) {
	output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return 0, err
	}
	ok := false
	defer func() {
		output.Close()
		if !ok {
			os.Remove(target)
		}
	}()
	readWord := func() (uint64, error) {
		word := make([]byte, headerBytes)
		if _, err := io.ReadFull(source, word); err != nil {
			return 0, err
		}
		if headerBytes == 4 {
			return uint64(binary.LittleEndian.Uint32(word)), nil
		}
		return binary.LittleEndian.Uint64(word), nil
	}
	if !compressed {
		length, err := readWord()
		if err != nil {
			return 0, errors.New("binary array has no length header")
		}
		if length > uint64(MaxDecodedArrayBytes) {
			return 0, errors.New("decoded VTU array exceeds conversion limit")
		}
		written, err := copyNWithCancellation(output, source, int64(length), cancelled)
		if err != nil {
			return 0, err
		}
		if written != int64(length) {
			return 0, io.ErrUnexpectedEOF
		}
		if err := output.Close(); err != nil {
			return 0, err
		}
		ok = true
		return written, nil
	}

	numBlocks, err := readWord()
	if err != nil || numBlocks == 0 || numBlocks > maxVTKCompressedBlocks {
		return 0, errors.New("invalid compressed VTU block count")
	}
	blockSize, err := readWord()
	if err != nil || blockSize == 0 || blockSize > uint64(MaxDecodedArrayBytes) {
		return 0, errors.New("invalid compressed VTU block size")
	}
	lastBlockSize, err := readWord()
	if err != nil || lastBlockSize == 0 || lastBlockSize > blockSize {
		return 0, errors.New("invalid compressed VTU final block size")
	}
	if numBlocks-1 > uint64(MaxDecodedArrayBytes)/blockSize {
		return 0, errors.New("decoded VTU array exceeds conversion limit")
	}
	expected := (numBlocks-1)*blockSize + lastBlockSize
	if expected > uint64(MaxDecodedArrayBytes) {
		return 0, errors.New("decoded VTU array exceeds conversion limit")
	}
	compressedSizes := make([]uint64, int(numBlocks))
	for index := range compressedSizes {
		compressedSizes[index], err = readWord()
		if err != nil || compressedSizes[index] == 0 || compressedSizes[index] > uint64(MaxDecodedArrayBytes) {
			return 0, errors.New("invalid compressed VTU block length")
		}
	}
	var written int64
	for index, compressedSize := range compressedSizes {
		if cancelled != nil && cancelled() {
			return 0, ErrCancelled
		}
		limited := &io.LimitedReader{R: source, N: int64(compressedSize)}
		inflated, err := zlib.NewReader(limited)
		if err != nil {
			return 0, fmt.Errorf("open compressed VTU block: %w", err)
		}
		blockExpected := int64(blockSize)
		if index == len(compressedSizes)-1 {
			blockExpected = int64(lastBlockSize)
		}
		blockWritten, copyErr := copyNWithCancellation(output, inflated, blockExpected, cancelled)
		extra := [1]byte{}
		extraBytes, extraErr := inflated.Read(extra[:])
		closeErr := inflated.Close()
		if copyErr != nil {
			return 0, copyErr
		}
		if extraErr != nil && !errors.Is(extraErr, io.EOF) {
			return 0, extraErr
		}
		if extraBytes != 0 {
			return 0, errors.New("compressed VTU block exceeds its declared decoded size")
		}
		if closeErr != nil {
			return 0, closeErr
		}
		if blockWritten != blockExpected {
			return 0, errors.New("compressed VTU block has unexpected decoded size")
		}
		if _, err := io.Copy(io.Discard, limited); err != nil {
			return 0, err
		}
		written += blockWritten
	}
	if written != int64(expected) {
		return 0, errors.New("compressed VTU array has unexpected decoded size")
	}
	if err := output.Close(); err != nil {
		return 0, err
	}
	ok = true
	return written, nil
}

func copyWithCancellation(target io.Writer, source io.Reader, cancelled func() bool) (int64, error) {
	buffer := make([]byte, streamBufferBytes)
	var written int64
	for {
		if cancelled != nil && cancelled() {
			return written, ErrCancelled
		}
		n, readErr := source.Read(buffer)
		if n > 0 {
			m, writeErr := target.Write(buffer[:n])
			written += int64(m)
			if writeErr != nil {
				return written, writeErr
			}
			if m != n {
				return written, io.ErrShortWrite
			}
		}
		if readErr != nil {
			if errors.Is(readErr, io.EOF) {
				return written, nil
			}
			return written, readErr
		}
	}
}

func copyNWithCancellation(target io.Writer, source io.Reader, count int64, cancelled func() bool) (int64, error) {
	written, err := copyWithCancellation(target, io.LimitReader(source, count), cancelled)
	if err == nil && written != count {
		err = io.ErrUnexpectedEOF
	}
	return written, err
}

func minInt64(left, right int64) int64 {
	if left < right {
		return left
	}
	return right
}
