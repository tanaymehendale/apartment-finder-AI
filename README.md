# 🏠 ApartmentFinder AI Agent

> Google x Kaggle AI Agents Intensive Capstone Project

ApartmentFinder is an intelligent multi-agent system designed to simplify the chaos of relocating. Instead of juggling tabs between Zillow, Google Maps, and Reddit, users have a single conversation with an AI that finds apartments, calculates real-time public transit commutes, vets neighborhood safety, and delivers a curated summary.

## The Problem

Relocating to a new city is overwhelming. A user typically has to:

1. Search listing sites for budget/amenities.
2. Copy addresses into Google Maps to check commute times during rush hour.
3. Search Google/Reddit to check if the neighborhood is safe.
4. Compile all this into a spreadsheet to make a decision.

This process is manual, fragmented, and time-consuming.

## The Solution

ApartmentFinder automates this entire pipeline using a Hierarchical Multi-Agent Architecture.

A "Manager" agent interfaces with the user to understand their specific needs. Once requirements are gathered, it deploys a specialized "Research Team" (a sequential chain of sub-agents) to execute the search, validate commute times using the Google Maps MCP server, and verify safety using Google Search.


## Architecture


(Note: Include your architecture diagram here)

1. **The Manager (Root Agent)**

 - Role: User Interface & Validator.
 - Behavior: It loops conversationally with the user until it has secured 4 key slots: City, State, Budget, and Landmark.
 - Handoff: Only when requirements are met does it trigger the ResearchTeam.

2. **The Research Team (Sequential Sub-Agent)**

Once triggered, this team executes a linear assembly line:

 - 🕵️ **Analyst Agent (The Worker)**
   - Tools: * fetch_apartments: Queries a local Pandas DataFrame (Mock Database) for listings.
   - check_commutes: Connects to a local Node.js MCP Server to query the live Google Maps API for transit times.

 - 🛡️ **Reviewer Agent (The Vetting Officer)**
   - Tools: Google Search (ADK Built-in).
   - Behavior: dynamic searches for neighborhood safety reviews based on the specific addresses found.

 - 📝 **Summarizer Agent (The Closer)**
   - Tools: None.
   - Behavior: Synthesizes the raw data into a persuasive, formatted pitch helping the user make a decision.

## 🛠️ Tech Stack

 - Framework: Google Agent Development Kit (ADK).
 - LLM: Gemini 2.5 Flash (via Vertex AI / AI Studio).
 - Tooling Protocol: Model Context Protocol (MCP) for Google Maps integration.
 - Data Layer: Pandas (handling CSV inventory).
 - Grounding: Google Search (Native ADK integration).

## Setup Instructions

### Prerequisites

 - Python 3.10+
 - Node.js v18+ (Required for the Google Maps MCP Server)
 - Google Cloud API Key with the following APIs enabled:
   - Geocoding API
   - Places API (New)
   - Distance Matrix API
   - Directions API

### Installation

1. Clone the repository:
```bash
git clone [https://github.com/yourusername/apartment-finder-ai.git](https://github.com/yourusername/apartment-finder-ai.git)
cd apartment-finder-ai
```

2. Install Python Dependencies:
```bash
python -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

3. Install MCP Server:
This project uses the official Google Maps MCP server.

```bash
npm init -y
npm install @modelcontextprotocol/server-google-maps zod
```

4. Configure Environment:
Create a .env file in the root directory:
```env
GOOGLE_API_KEY="your_gemini_api_key"
GOOGLE_MAPS_API_KEY="your_google_maps_api_key"
```

## Usage

Run the main application script. The Python agent will automatically spin up the Node.js MCP server in the background.
```bash
python main.py
```
```
Example Interaction:

Agent: "Hello! I can help you relocation. Where are you moving?"
User: "I'm looking for a place in Austin, TX under $2500."
Agent: "Got it. Where will you be commuting to?"
User: "The Tesla Gigafactory."
Agent: (Thinking...) Delegates to Analyst -> Checks Maps -> Checks Reviews...
Agent: "I found a great option for you! The Riverside Lofts are $2,100/month. The commute is 15 mins via car, and reviews indicate the neighborhood is improving..."
```

## 📂 Project Structure
```
apartment-finder-ai/
├── agents/
│   └── apartment_finder/
│       ├── agent.py         # Agent Definitions (Manager, Analyst, Reviewer)
│       └── tools.py         # Python Tools & MCP Wrapper Logic
├── data/
│   └── apartments.csv       # Mock Inventory Database
├── main.py                  # Entry point & Runner
├── package.json             # Node dependencies (MCP)
└── requirements.txt         # Python dependencies
```