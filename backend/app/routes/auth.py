from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import User
from app.schemas import LoginRequest, RegisterRequest, TokenResponse, UserResponse
from app.services.auth_service import create_access_token, get_current_user, hash_password, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    normalized_email = body.email.lower().strip()

    existing = await db.execute(select(User).where(User.email == normalized_email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="An account with that email already exists")

    user = User(email=normalized_email, password_hash=hash_password(body.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return TokenResponse(access_token=create_access_token(user.id))


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)) -> TokenResponse:
    normalized_email = body.email.lower().strip()

    result = await db.execute(select(User).where(User.email == normalized_email))
    user = result.scalar_one_or_none()

    # Run bcrypt even on unknown email to avoid timing-based user enumeration.
    # A real hash is used so bcrypt doesn't raise on an invalid salt format.
    DUMMY_HASH = "$2b$12$yKpCZVDLTz2tRaEuHYODQOZoFJwBiT9.xEb4NfB8FGVMGzU1OJV2e"
    candidate_hash = user.password_hash if user else DUMMY_HASH
    try:
        password_ok = verify_password(body.password, candidate_hash)
    except Exception:
        password_ok = False

    if not user or not password_ok:
        raise HTTPException(status_code=401, detail="Incorrect email or password")

    return TokenResponse(access_token=create_access_token(user.id))


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)) -> UserResponse:
    return current_user
