# Custom BYOK providers

The built-in BYOK protocols (Anthropic, OpenAI, Azure, Google, Ollama,
SenseAudio, AIHubMix) are hardcoded in the daemon: each has a fixed endpoint
suffix, fixed headers, a fixed request body, and a fixed response parser. A
**custom** BYOK provider lets you define all of that yourself in a config file,
so you can point Open Design at any HTTP chat API without changing source.

You define:

1. the message-call **endpoint** (the full URL),
2. the **headers** — fixed values, including your API key,
3. the request **body template**,
4. how to **extract the result text** from the JSON response, and
5. the **model list** (the label is shown in the picker; the id is injected
   into your request body).

## Config file

The daemon reads custom providers from a JSON file, resolved in this order:

1. `OD_BYOK_PROVIDERS_CONFIG` (an explicit path), else
2. `~/.open-design/byok-providers.local.json`.

This mirrors the `agents.local.json` precedent: it is a user integration input,
not daemon runtime data (see the *Daemon data directory contract* in
`AGENTS.md`). The file is re-read on every request, so edits take effect without
restarting the daemon.

```jsonc
{
  "providers": [
    {
      "id": "my-llm",                                  // stable identifier
      "label": "My LLM",                               // shown in the picker
      "endpoint": "https://api.example.com/v1/chat/completions",
      "method": "POST",                                // optional, default POST
      "headers": {                                     // fixed values + secrets
        "Content-Type": "application/json",
        "Authorization": "Bearer sk-your-key",
        "X-Fixed-Header": "fixed-value"
      },
      "bodyTemplate": {                                // see template variables
        "model": "{{model}}",
        "messages": "{{messages}}",
        "max_tokens": 4096,
        "stream": false
      },
      "responseTextPath": "choices.0.message.content", // result text location
      "models": [
        { "id": "gpt-4o", "label": "GPT-4o" },
        { "id": "internal-7b", "label": "Internal 7B" }
      ]
    }
  ]
}
```

A provider is skipped (with a warning logged) if it is missing `id`,
`endpoint`, `headers`, `bodyTemplate`, `responseTextPath`, or a non-empty
`models` list, or if its `endpoint` resolves to a blocked/internal address
(the same SSRF guard the other BYOK proxies use; loopback is allowed for local
model servers).

> Secrets stay on the daemon. The web UI and `od byok providers list` only ever
> receive the `id`, `label`, and `models` — never the endpoint, headers, or
> body template.

## Template variables

String values in `headers` and `bodyTemplate` are interpolated. These variables
are recognized:

| Variable           | Replaced with                                              |
| ------------------ | ---------------------------------------------------------- |
| `{{model}}`        | the selected model id (string)                             |
| `{{systemPrompt}}` | the system prompt (string)                                 |
| `{{prompt}}`       | the latest user message text (string)                      |
| `{{maxTokens}}`    | the max-tokens cap (string)                                |
| `{{messages}}`     | the conversation as a `{ role, content }` array            |

`{{messages}}` is special: when a JSON **value** is exactly the string
`"{{messages}}"`, it is replaced wholesale with the message array (not a
string). Everywhere else, variables are string-interpolated.

## Response extraction

`responseTextPath` is a dotted path with numeric array indices into the parsed
JSON response. Examples:

- OpenAI-shaped: `choices.0.message.content`
- Anthropic-shaped: `content.0.text`

The proxy issues one non-streaming request, reads the text at that path, and
replays it to the chat as a single update.

## Using it

- **Web UI**: Settings → execution mode → API (BYOK) → the **Custom** tab.
  Pick a provider, then one of its models. There is no API-key or Base-URL
  field — those live in your config file.
- **CLI**: `od byok providers list [--json]` prints the configured providers
  and their models.
