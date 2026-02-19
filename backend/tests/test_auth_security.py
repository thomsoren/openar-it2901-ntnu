"""Tests for auth/security.py — JWT creation and validation."""
from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi import HTTPException

from auth.security import create_access_token, decode_access_token


class TestCreateAccessToken:
    def test_returns_string(self):
        token = create_access_token(subject="user-1")
        assert isinstance(token, str)
        assert len(token) > 0

    def test_encodes_subject(self):
        token = create_access_token(subject="user-42")
        payload = decode_access_token(token)
        assert payload["sub"] == "user-42"

    def test_additional_claims_included(self):
        token = create_access_token(subject="user-1", additional_claims={"role": "admin"})
        payload = decode_access_token(token)
        assert payload["role"] == "admin"

    def test_custom_expiry(self):
        token = create_access_token(subject="user-1", expires_delta=timedelta(hours=1))
        payload = decode_access_token(token)
        assert "exp" in payload


class TestDecodeAccessToken:
    def test_valid_token(self):
        token = create_access_token(subject="user-1")
        payload = decode_access_token(token)
        assert payload["sub"] == "user-1"

    def test_expired_token_raises(self):
        token = create_access_token(subject="user-1", expires_delta=timedelta(seconds=-1))
        with pytest.raises(HTTPException) as exc_info:
            decode_access_token(token)
        assert exc_info.value.status_code == 401

    def test_tampered_token_raises(self):
        token = create_access_token(subject="user-1")
        # Flip a character in the signature portion
        tampered = token[:-4] + ("A" if token[-4] != "A" else "B") + token[-3:]
        with pytest.raises(HTTPException) as exc_info:
            decode_access_token(tampered)
        assert exc_info.value.status_code == 401

    def test_garbage_token_raises(self):
        with pytest.raises(HTTPException) as exc_info:
            decode_access_token("not-a-jwt")
        assert exc_info.value.status_code == 401

    def test_empty_subject_raises(self):
        """A token with sub='' should be rejected."""
        from jose import jwt as jose_jwt
        from auth.config import settings

        token = jose_jwt.encode(
            {"sub": "", "exp": 9999999999},
            settings.jwt_secret_key,
            algorithm=settings.jwt_algorithm,
        )
        with pytest.raises(HTTPException) as exc_info:
            decode_access_token(token)
        assert exc_info.value.status_code == 401

    def test_missing_subject_raises(self):
        """A token without a sub claim should be rejected."""
        from jose import jwt as jose_jwt
        from auth.config import settings

        token = jose_jwt.encode(
            {"exp": 9999999999},
            settings.jwt_secret_key,
            algorithm=settings.jwt_algorithm,
        )
        with pytest.raises(HTTPException) as exc_info:
            decode_access_token(token)
        assert exc_info.value.status_code == 401
