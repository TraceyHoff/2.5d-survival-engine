"""ADR-112 / ADR-113 decor pieces for the building pack (see lib.py for conventions)."""
from .lib import REG, emit, CELLS
from . import farm  # noqa: F401  (ADR-113 feeding_trough)
from . import furniture, lights  # noqa: F401  (ADR-112 commit 2)
from . import decorations  # noqa: F401  (ADR-112 commit 3)
from . import home  # noqa: F401  (ADR-112 commit 4)
GROUPS = ['farm', 'furn', 'light', 'deco', 'home']  # emission order; append new groups, never reorder
