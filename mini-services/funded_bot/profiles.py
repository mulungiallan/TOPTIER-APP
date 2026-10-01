"""Rule profiles for each FundingPips model, taken from fundedpips.txt.

Anything the uploaded file does NOT state is listed in Profile.notes so you can
verify it on the FundingPips site before running the bot.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Profile:
    key: str
    label: str
    phase: str                       # phase1 | phase2 | master
    size: float                      # starting account size
    daily_loss_pct: float            # % of the day's baseline (higher of open balance/equity)
    max_loss_pct: float              # % of starting size
    max_loss_mode: str               # "trailing_lock" | "static"
    trail_lock_profit_pct: float = 0.0
    open_risk_pct: float | None = None       # Zero: floating loss cap, % of starting size
    idea_limit_pct: float | None = None      # Zero: max loss per "trade idea"
    news_restricted: bool = False
    weekend_hold_allowed: bool = True
    target_pct: float | None = None
    min_trading_days: int = 0
    profitable_day_pct: float | None = None
    profitable_days_needed: int | None = None
    profitable_days_window: int = 30
    inactivity_days: int = 30
    notes: tuple = ()


SIZES = {
    "zero": (5000, 10000, 25000, 50000, 100000, 200000),
    "1step_flex": (5000, 10000, 25000, 50000, 100000),
    "2step_standard": (5000, 10000, 25000, 50000, 100000),
    "2step_flex": (5000, 10000, 25000, 50000, 100000),
    "2step_pro": (5000, 10000, 25000, 50000, 100000, 200000),
}

PHASES = {
    "zero": ("master",),
    "1step_flex": ("phase1", "master"),
    "2step_standard": ("phase1", "phase2", "master"),
    "2step_flex": ("phase1", "phase2", "master"),
    "2step_pro": ("phase1", "phase2", "master"),
}

MODELS = tuple(SIZES)


def build_profile(model: str, phase: str, size: float, split: int = 80) -> Profile:
    model, phase = model.lower(), phase.lower()
    if model not in SIZES:
        raise ValueError(f"unknown model {model!r}; choose from {MODELS}")
    if phase not in PHASES[model]:
        raise ValueError(f"{model} has phases {PHASES[model]}, not {phase!r}")
    if int(size) not in SIZES[model]:
        raise ValueError(f"{model} sizes are {SIZES[model]}, not {size}")

    master = phase == "master"
    base = dict(
        key=model,
        phase=phase,
        size=float(size),
        # News restriction + weekend ban apply on Master accounts (and always on Zero).
        news_restricted=master,
        weekend_hold_allowed=not master,
    )

    if model == "zero":
        return Profile(
            **{**base, "news_restricted": True, "weekend_hold_allowed": False},
            label="FundingPips Zero",
            daily_loss_pct=3.0,
            max_loss_pct=5.0,
            max_loss_mode="trailing_lock",
            trail_lock_profit_pct=5.0,
            open_risk_pct=1.0,
            idea_limit_pct=3.0 if size < 50000 else 2.0,
            profitable_day_pct=0.25,
            profitable_days_needed=7,
            notes=(
                "News window times are not in the uploaded file: set news_before_min / "
                "news_after_min in config to what the FundingPips page says.",
            ),
        )

    if model == "1step_flex":
        return Profile(
            **base,
            label="1 Step Flex",
            daily_loss_pct=3.0,
            max_loss_pct=12.0,
            max_loss_mode="static",
            target_pct=None if master else 12.0,
        )

    if model == "2step_standard":
        return Profile(
            **base,
            label="2 Step Standard",
            daily_loss_pct=3.0,
            max_loss_pct=10.0,
            max_loss_mode="static",
            target_pct=None if master else {"phase1": 8.0, "phase2": 5.0}[phase],
            min_trading_days=0 if master else 3,
            notes=(
                "The file does NOT state 2 Step Standard loss limits. The bot assumes 3% daily "
                "(safe for both the default and the '3% daily add-on' variants) and 10% static "
                "max loss. Verify on your dashboard.",
            ),
        )

    if model == "2step_flex":
        p = dict(
            **base,
            label=f"2 Step Flex ({split}% split)",
            daily_loss_pct=4.0,
            max_loss_pct=12.0,
            max_loss_mode="static",
            target_pct=None if master else {"phase1": 10.0, "phase2": 8.0}[phase],
        )
        if split == 95:
            p.update(profitable_day_pct=0.5, profitable_days_needed=3)
        else:
            p.update(min_trading_days=0 if master else 1)
        return Profile(**p)

    if model == "2step_pro":
        return Profile(
            **base,
            label="2 Step Pro",
            daily_loss_pct=3.0,
            max_loss_pct=6.0,
            max_loss_mode="static",
            target_pct=None if master else 6.0,
            min_trading_days=0 if master else 2,
            notes=(
                "The file does not say whether the 6% max loss is static or trailing. The bot "
                "treats it as static from the starting balance; verify on your dashboard.",
            ),
        )

    raise AssertionError("unreachable")
