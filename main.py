import asyncio
import os
from dotenv import load_dotenv
from google.adk.runners import InMemoryRunner
from apartment_finder.agent import root_agent

load_dotenv()

async def main():
    print("🏗️  ApartmentFinder System Starting...")

    # Validate required keys before any agent call to surface errors early (M9)
    missing = [k for k in ["GOOGLE_API_KEY", "GOOGLE_MAPS_API_KEY"] if not os.getenv(k)]
    if missing:
        print(f"❌ ERROR: Missing required API keys: {', '.join(missing)}")
        print("   Add them to your .env file and restart.")
        return

    if not os.getenv("RENTCAST_API_KEY") and not os.getenv("APIFY_API_KEY"):
        print("❌ ERROR: No listing provider key found (RENTCAST_API_KEY / APIFY_API_KEY).")
        print("   At least one is required — there is no offline fallback. Add one to .env and restart.")
        return

    # Initialize runner with an explicit app_name so session_service can manage sessions
    runner = InMemoryRunner(agent=root_agent, app_name="apartment_finder")

    # Create a session explicitly via InMemorySessionService (C2).
    # This pre-registers the session so state is consistent across all turns.
    session = await runner.session_service.create_session(
        app_name="apartment_finder",
        user_id="local_user"
    )

    print("\n✅ System Ready! The Manager is listening. (Type 'quit' to exit)")

    while True:
        try:
            user_input = input("\nUser >> ")
            if user_input.lower() in ["quit", "exit"]:
                break

            print("\n" + "="*50)
            await runner.run_debug(
                user_input,
                user_id="local_user",
                session_id=session.id   # Pin every turn to the same session
            )
            print("="*50)

        except Exception as e:
            print(f"\n❌ Error: {e}")
            import traceback
            traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(main())
