import os
from google.adk.agents import Agent, LlmAgent, SequentialAgent
from google.genai import types
from google.adk.models.google_llm import Gemini
from google.adk.tools import google_search
from typing import List
from . import instructions
from . import tools

retry_config = types.HttpRetryOptions(
    attempts=5,  # Maximum retry attempts
    exp_base=7,  # Delay multiplier
    initial_delay=1,
    http_status_codes=[429, 500, 503, 504],  # Retry on these HTTP errors
)

# Defining the Model
model = Gemini(model="gemini-2.5-flash", retry_options=retry_config)

# Defining Sub-Agents of the Research Team
# --- 1. THE ANALYST AGENT ---
analyst = LlmAgent(
    name="analyst",
    model=model,
    description="Executes tools to find and analyze apartments.",
    instruction=instructions.ANALYST_PROMPT,
    # It uses all only custom tools: Custom (Inventory), MCP (Commute)
    tools=[tools.fetch_apartments, tools.check_commutes], 
    output_key="analyst_dossier"
)

# --- 2. THE REVIEWER AGENT ---
reviewer = Agent(
    name="reviewer",
    model=model,
    description="Checks neighborhood safety.",
    instruction=instructions.REVIEWER_PROMPT,
    tools=[google_search],
    output_key="safety_report"
)

# --- 3. THE SUMMARIZER AGENT ---
summarizer = LlmAgent(
    name="summarizer",
    model=model,
    description="Compiles research into a final pitch.",
    instruction=instructions.SUMMARIZER_PROMPT
)

# --- THE RESEARCH TEAM ---
research_team = SequentialAgent(
    name="ResearchTeam",
    description="A team that finds, vets, and summarizes apartments.",
    sub_agents=[analyst, reviewer, summarizer]
)

# --- ROOT AGENT (MAIN) ---

root_agent = LlmAgent(
    name="manager",
    description="Conversational agent that gathers user requirements.",
    model=model,
    instruction=instructions.MANAGER_PROMPT,
    sub_agents=[research_team]
    # output_key="user_requirements"
)