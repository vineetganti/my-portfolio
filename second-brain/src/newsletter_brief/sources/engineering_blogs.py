"""Candidate company engineering / research blogs for the 'engineering' feed.

FEED URLS HERE ARE GUESSES FROM MEMORY until `scripts/probe_feeds.py` has confirmed them
(results land in data/cache/feed_probe.json). Only confirmed entries should be ingested.
group: ai-lab | bigtech | infra | product  (used to sectionize the feed later)
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class Candidate:
    id: str
    name: str
    group: str
    feed_url: str


CANDIDATES: list[Candidate] = [
    # AI labs and AI research
    Candidate("openai", "OpenAI", "ai-lab", "https://openai.com/news/rss.xml"),
    Candidate("anthropic", "Anthropic", "ai-lab", "https://www.anthropic.com/rss.xml"),
    Candidate("deepmind", "Google DeepMind", "ai-lab", "https://deepmind.google/blog/rss.xml"),
    Candidate("google-research", "Google Research", "ai-lab", "https://research.google/blog/rss/"),
    Candidate("meta-ai", "Meta AI", "ai-lab", "https://ai.meta.com/blog/rss/"),
    Candidate("microsoft-research", "Microsoft Research", "ai-lab", "https://www.microsoft.com/en-us/research/feed/"),
    Candidate("huggingface", "Hugging Face", "ai-lab", "https://huggingface.co/blog/feed.xml"),
    Candidate("nvidia-dev", "NVIDIA Technical Blog", "ai-lab", "https://developer.nvidia.com/blog/feed/"),
    Candidate("apple-ml", "Apple Machine Learning Research", "ai-lab", "https://machinelearning.apple.com/rss.xml"),
    Candidate("aws-ml", "AWS Machine Learning Blog", "ai-lab", "https://aws.amazon.com/blogs/machine-learning/feed/"),
    # Big tech engineering
    Candidate("meta-eng", "Meta Engineering", "bigtech", "https://engineering.fb.com/feed/"),
    Candidate("netflix", "Netflix Tech Blog", "bigtech", "https://netflixtechblog.com/feed"),
    Candidate("uber", "Uber Engineering", "bigtech", "https://www.uber.com/blog/engineering/rss/"),
    Candidate("airbnb", "Airbnb Engineering", "bigtech", "https://medium.com/feed/airbnb-engineering"),
    Candidate("linkedin", "LinkedIn Engineering", "bigtech", "https://engineering.linkedin.com/blog.rss.html"),
    Candidate("spotify", "Spotify Engineering", "bigtech", "https://engineering.atspotify.com/feed/"),
    Candidate("pinterest", "Pinterest Engineering", "bigtech", "https://medium.com/feed/pinterest-engineering"),
    Candidate("dropbox", "Dropbox Tech", "bigtech", "https://dropbox.tech/feed"),
    Candidate("slack", "Slack Engineering", "bigtech", "https://slack.engineering/feed/"),
    Candidate("lyft", "Lyft Engineering", "bigtech", "https://eng.lyft.com/feed"),
    Candidate("salesforce", "Salesforce Engineering", "bigtech", "https://engineering.salesforce.com/feed/"),
    Candidate("aws-arch", "AWS Architecture Blog", "bigtech", "https://aws.amazon.com/blogs/architecture/feed/"),
    # Infra and developer platforms
    Candidate("cloudflare", "Cloudflare Blog", "infra", "https://blog.cloudflare.com/rss/"),
    Candidate("github", "GitHub Engineering", "infra", "https://github.blog/engineering/feed/"),
    Candidate("stripe", "Stripe Blog", "infra", "https://stripe.com/blog/feed.rss"),
    Candidate("vercel", "Vercel Blog", "infra", "https://vercel.com/atom"),
    Candidate("databricks", "Databricks Blog", "infra", "https://www.databricks.com/feed"),
    Candidate("datadog", "Datadog Engineering", "infra", "https://www.datadoghq.com/blog/engineering/index.xml"),
    Candidate("discord", "Discord Engineering", "infra", "https://discord.com/blog/rss.xml"),
    Candidate("shopify", "Shopify Engineering", "infra", "https://shopify.engineering/blog.atom"),
    # Product / startup engineering
    Candidate("figma", "Figma Blog", "product", "https://www.figma.com/blog/feed/atom.xml"),
    Candidate("doordash", "DoorDash Engineering", "product", "https://careersatdoordash.com/blog/feed/"),
    Candidate("instacart", "Instacart Tech", "product", "https://tech.instacart.com/feed"),
    Candidate("notion", "Notion Blog", "product", "https://www.notion.com/blog/rss.xml"),
]
