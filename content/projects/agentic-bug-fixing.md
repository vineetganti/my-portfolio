---
title: "Agentic Bug Fixing: an LLM that repairs crashing Python"
description: "A small LangGraph agent that runs a Python function, asks an LLM on Groq to rewrite it when it crashes, loads the rewrite and runs it again, at most three times. It has a terminal demo and a Gradio app that shows each fix as a diff. The agent and its explainer are by Shivank Agarwal (Future with Shivank) for Scaler Academy's Agentic AI course; my copy is ported to Groq and packaged, with the bugs found while writing it up fixed. The Blog link opens the write-up of every step, error and re-run."
tags: ["Python", "LangGraph", "LangChain", "Groq", "Gradio"]
url: "https://vineetganti.com/blog/agentic-bug-fixing"
github: "https://github.com/vineetganti/agentic-bug-fixing"
featured: true
---
