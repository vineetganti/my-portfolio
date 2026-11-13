"""Run once (and again whenever the token expires) to authorize Gmail read-only."""
from newsletter_brief.ingest.auth import gmail_service

if __name__ == "__main__":
    profile = gmail_service().users().getProfile(userId="me").execute()
    print("Authorized as", profile["emailAddress"])
