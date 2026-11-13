from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from newsletter_brief.config import settings

# Read-only on purpose: the agent can never send, modify or delete mail.
SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


def get_credentials() -> Credentials:
    creds = None
    if settings.google_token_path.exists():
        creds = Credentials.from_authorized_user_file(str(settings.google_token_path), SCOPES)
    if creds and creds.valid:
        return creds
    if creds and creds.expired and creds.refresh_token:
        try:
            creds.refresh(Request())
        except Exception:
            # Test-mode OAuth apps expire refresh tokens after ~7 days -> re-auth.
            creds = None
    if not creds or not creds.valid:
        flow = InstalledAppFlow.from_client_secrets_file(str(settings.google_client_secrets), SCOPES)
        creds = flow.run_local_server(port=0)
    settings.google_token_path.write_text(creds.to_json())
    return creds


def gmail_service():
    return build("gmail", "v1", credentials=get_credentials(), cache_discovery=False)
