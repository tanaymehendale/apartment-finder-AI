from google.adk.agents import LlmAgent, SequentialAgent
from google.genai import types
from google.adk.models.google_llm import Gemini
from google.adk.tools import FunctionTool
from google.adk.tools import google_search
from . import instructions
from . import tools

retry_config = types.HttpRetryOptions(
    attempts=5,
    exp_base=7,   # Long backoff keeps retries outside the 60s RPM window on free tier
    initial_delay=1,
    http_status_codes=[429, 500, 503, 504],
)

model = Gemini(model="gemini-2.5-flash", retry_options=retry_config)

# --- 1. THE ANALYST AGENT ---
analyst = LlmAgent(
    name="analyst",
    model=model,
    description="Executes tools to find and analyze apartments.",
    instruction=instructions.ANALYST_PROMPT,
    tools=[FunctionTool(tools.fetch_apartments), FunctionTool(tools.check_commutes)],
    output_key="analyst_dossier"
)

# --- 2. THE REVIEWER AGENT ---
reviewer = LlmAgent(
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
# store_requirements writes user input to session state before ResearchTeam runs,
# avoiding the fragile "read last Manager message" pattern that breaks on one-shot queries.
root_agent = LlmAgent(
    name="manager",
    description="Conversational agent that gathers user requirements.",
    model=model,
    instruction=instructions.MANAGER_PROMPT,
    tools=[FunctionTool(tools.store_requirements)],
    sub_agents=[research_team]
)
