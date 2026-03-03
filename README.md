# TBYC Backend

Backend infrastructure for the TBYC Chrome extension using Supabase Edge Functions.

## Setup with Your Own Supabase

### 1. Prerequisites
- [Supabase CLI](https://supabase.com/docs/guides/cli/getting-started)
- Supabase account

### 2. Link to Your Project
```bash
cd supabase
supabase link --project-ref your-project-ref
```

### 3. Set Environment Secrets
```bash
supabase secrets set AI_API_KEY=your_gemini_api_key
supabase secrets set TBYC_PROXY_KEY=your_custom_proxy_key
```

- `AI_API_KEY`: Your Google Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey)
- `TBYC_PROXY_KEY`: Custom key for authenticating requests from your extension (set this to match your extension config)

### 4. Deploy the Function
```bash
supabase functions deploy ai-assess
```

### 5. Get Your Function URL
After deployment, your function will be available at:
```
https://your-project-ref.supabase.co/functions/v1/ai-assess
```

Update your Chrome extension to use this URL.

## Function Overview

**ai-assess**: Analyzes URLs for phishing risk using AI (Gemini 2.5 Flash) based on heuristic signals from the extension.

### Request Format
```json
{
  "url": "https://example.com",
  "heuristic": {
    "preview": "page text content...",
    "contentPreview": "...",
    "selectionPreview": "..."
  },
  "mode": "borderline"
}
```

### Response Format
```json
{
  "aiRiskLevel": "SAFE|WARNING|HIGH_RISK",
  "confidence": 0.95,
  "reasons": ["reason 1", "reason 2"],
  "recommendedAction": "PROCEED|CAUTION|AVOID"
}
```

## Local Development

```bash
supabase start
supabase functions serve ai-assess
```

Test locally:
```bash
curl -i --location --request POST 'http://127.0.0.1:54321/functions/v1/ai-assess' \
  --header 'X-TBYC-KEY: your_proxy_key' \
  --header 'Content-Type: application/json' \
  --data '{"url":"https://example.com","heuristic":{}}'
```

## License

MIT License - see [LICENSE](LICENSE) file for details.
