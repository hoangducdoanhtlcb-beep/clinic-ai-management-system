from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.security import get_current_user, require_roles
from app.routers.health import router as health_router
from app.routers.db_health import router as db_health_router
from app.routers.auth import router as auth_router
from app.routers.users import router as users_router
from app.routers.patients import router as patients_router
from app.routers.doctors import router as doctors_router
from app.routers.shifts import router as shifts_router
from app.routers.appointments import router as appointments_router
from app.routers.medical_records import router as medical_records_router
from app.routers.services import router as services_router
from app.routers.invoices import router as invoices_router
from app.routers.reports import router as reports_router
from app.routers.logs import router as logs_router
from app.routers.patient_portal import router as patient_portal_router
from app.routers.ai import router as ai_router

app = FastAPI(
    title="Clinic AI API",
    description="Backend API for the Clinic AI management system.",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Public local-development endpoints
app.include_router(health_router, prefix="/api")
app.include_router(db_health_router, prefix="/api")
app.include_router(auth_router, prefix="/api")

# Actor permissions are enforced inside each business router so GET and
# mutation permissions can follow the Use Case specification independently.
app.include_router(
    users_router, prefix="/api",
    dependencies=[Depends(require_roles("admin"))],
)
app.include_router(patients_router, prefix="/api")
app.include_router(doctors_router, prefix="/api")
app.include_router(shifts_router, prefix="/api")
app.include_router(appointments_router, prefix="/api")
app.include_router(
    medical_records_router, prefix="/api",
    dependencies=[Depends(get_current_user)],
)
app.include_router(
    services_router, prefix="/api",
    dependencies=[Depends(get_current_user)],
)
app.include_router(
    invoices_router, prefix="/api",
    dependencies=[Depends(get_current_user)],
)
app.include_router(reports_router, prefix="/api")
app.include_router(logs_router, prefix="/api")
app.include_router(
    patient_portal_router, prefix="/api",
    dependencies=[Depends(get_current_user)],
)
app.include_router(ai_router, prefix="/api")


@app.get("/", tags=["Root"])
def root():
    return {
        "message": "Clinic AI Backend is running",
        "docs": "/docs",
        "health": "/api/health",
        "database_health": "/api/db-health",
        "login": "/api/auth/login",
    }
