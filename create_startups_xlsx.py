import pandas as pd

# Data extracted from the research session
data = [
    {"Company Name": "Mistral AI", "Sector": "LLM / Infrastructure", "Key Innovation": "High-efficiency open-weights models", "Funding Stage": "Series B/C"},
    {"Company Name": "Perplexity AI", "Sector": "Search / Knowledge Engine", "Key Innovation": "Real-time AI search and citation", "Funding Stage": "Series B/C"},
    {"Company Name": "Cohere", "Sector": "Enterprise AI", "Key Innovation": "RAG and enterprise-grade LLMs", "Funding Stage": "Series C/D"},
    {"Company Name": "Anthropic", "Sector": "AI Safety / LLM", "Key Innovation": "Constitutional AI and Claude models", "Funding Stage": "Series C/D"},
    {"Company Name": "Glean", "Sector": "Enterprise Search", "Key Innovation": "AI-powered workplace search", "Funding Stage": "Series D"},
    {"Company Name": "Hugging Face", "Sector": "AI Community / Infrastructure", "Key Innovation": "Centralized hub for open-source models", "Funding Stage": "Series B/C"},
    {"Company Name": "DeepL", "Sector": "Translation", "Key Innovation": "High-accuracy neural translation", "Funding Stage": "Series C/D"},
    {"Company Name": "Character.ai", "Sector": "Consumer AI / Personas", "Key Innovation": "Interactive conversational agents", "Funding Stage": "Series B/C"},
]

df = pd.DataFrame(data)

# Save to the artifact path
output_path = "rising_ai_startups_2026.xlsx"
df.to_excel(output_path, index=False)
print(f"Successfully created {output_path}")
