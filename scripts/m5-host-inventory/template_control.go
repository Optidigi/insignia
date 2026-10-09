// Local synthetic Go-template control. No Docker socket, provider or network.
package main

import (
	"encoding/json"
	"io"
	"os"
	"strings"
	"text/template"
)

func main() {
	var input struct {
		Template string         `json:"template"`
		Metadata map[string]any `json:"metadata"`
	}
	bytes, err := io.ReadAll(io.LimitReader(os.Stdin, 1024*1024+1))
	if err != nil || len(bytes) > 1024*1024 || json.Unmarshal(bytes, &input) != nil {
		os.Exit(1)
	}
	functions := template.FuncMap{
		"json": func(value any) (string, error) {
			encoded, err := json.Marshal(value)
			return string(encoded), err
		},
		"split": strings.Split,
	}
	parsed, err := template.New("fixed-metadata").Funcs(functions).Parse(input.Template)
	if err != nil || parsed.Execute(os.Stdout, input.Metadata) != nil {
		os.Exit(1)
	}
}
