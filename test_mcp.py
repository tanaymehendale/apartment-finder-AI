# This is a test script to verify the working of the local Node.js MCP Server used for the 'check_commutes' tool
import os
import asyncio
from dotenv import load_dotenv
from google import genai
from google.genai.types import Tool, GenerateContentConfig, FunctionDeclaration
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

load_dotenv()

async def run_test():
    print("🚀 Launching Local Google Maps Server...")

    # 1. CONSTRUCT PATH TO LOCAL SERVER
    # We point directly to the file inside 'node_modules'
    script_path = os.path.join(os.getcwd(), "node_modules", "@modelcontextprotocol", "server-google-maps", "dist", "index.js")
    
    if not os.path.exists(script_path):
        print(f"❌ Error: Could not find server at {script_path}")
        print("Did you run 'npm install @modelcontextprotocol/server-google-maps'?")
        return

    # 2. CONFIGURE SERVER
    server_params = StdioServerParameters(
        command="node", # Run node directly
        args=[script_path],
        env={
            "GOOGLE_MAPS_API_KEY": os.getenv("GOOGLE_MAPS_API_KEY")
        }
    )

    # 3. RUN
    async with stdio_client(server_params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            
            # List Tools
            mcp_tools = await session.list_tools()
            print(f"✅ Connected! Found tools: {[t.name for t in mcp_tools.tools]}")

            # Convert to Gemini Tools
            gemini_tools = []
            for tool in mcp_tools.tools:
                gemini_tools.append(FunctionDeclaration(
                    name=tool.name,
                    description=tool.description,
                    parameters=tool.inputSchema
                ))
            
            # Test Gemini
            client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))
            prompt = "What are the commute options from Milpitas, CA to Sunnyvale, CA?"
            print(f"\n❓ User: {prompt}")

            response = await client.aio.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=GenerateContentConfig(
                    tools=[Tool(function_declarations=gemini_tools)]
                )
            )

            for part in response.candidates[0].content.parts:
                if part.function_call:
                    fc = part.function_call
                    print(f"🤖 Gemini calling: {fc.name}")
                    result = await session.call_tool(fc.name, arguments=fc.args)
                    print(f"🌍 Result: {str(result.content)[:100]}...")
                    return
            
            print("🤔 No tool called.")

if __name__ == "__main__":
    asyncio.run(run_test())