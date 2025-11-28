# backend/main.py
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from database import engine, Base, get_db
import models

# Create the database tables automatically
models.Base.metadata.create_all(bind=engine)

app = FastAPI()

# Allow the frontend to talk to the backend (CORS)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"], # Vite's default port
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Ultimate Frisbee Stats API is running!"}

@app.get("/players/")
def read_players(db: Session = Depends(get_db)):
    # This will return all players once we populate the DB
    return db.query(models.Player).all()