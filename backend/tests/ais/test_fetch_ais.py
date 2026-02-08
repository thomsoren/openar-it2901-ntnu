import pytest
from unittest.mock import AsyncMock, patch
from ais.fetch_ais import (
    _fetch_token,
    fetch_ais,
    fetch_ais_stream_geojson
)


class TestFetchToken:
    """Tests for _fetch_token function"""
    
    @pytest.mark.asyncio
    async def test_fetch_token_missing_credentials(self):
        """Test token fetch with missing credentials"""
        mock_session = AsyncMock()
        
        with patch('ais.fetch_ais.AIS_CLIENT_ID', ''), \
             patch('ais.fetch_ais.AIS_CLIENT_SECRET', ''):
            with pytest.raises(ValueError, match="AIS_CLIENT_ID or AIS_CLIENT_SECRET is missing"):
                await _fetch_token(mock_session)

class TestFetchAIS:
    """Tests for fetch_ais function"""
    
    @pytest.mark.asyncio
    async def test_fetch_ais_missing_credentials(self):
        """Test fetch_ais with missing credentials"""
        with patch('ais.fetch_ais.AIS_CLIENT_ID', ''), \
             patch('ais.fetch_ais.AIS_CLIENT_SECRET', ''):
            result = await fetch_ais()
            assert result is None

class TestFetchAISStreamGeoJSON:
    """Tests for fetch_ais_stream_geojson function"""
    
    @pytest.mark.asyncio
    async def test_stream_missing_credentials(self):
        """Test stream with missing credentials"""
        with patch('ais.fetch_ais.AIS_CLIENT_ID', ''), \
             patch('ais.fetch_ais.AIS_CLIENT_SECRET', ''):
            with pytest.raises(ValueError, match="AIS_CLIENT_ID or AIS_CLIENT_SECRET not set"):
                async for _ in fetch_ais_stream_geojson():
                    pass
    
    