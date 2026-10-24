"""ADR-112 / ADR-113 decor pieces for the building pack (see lib.py for conventions)."""
from .lib import REG, emit, CELLS
from . import farm  # noqa: F401  (ADR-113 feeding_trough)
GROUPS = ['farm']  # emission order; append new groups, never reorder
