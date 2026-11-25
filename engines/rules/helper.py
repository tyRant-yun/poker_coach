"""Deterministic, stateless NLHE adapter. stdout is JSONL protocol only."""
import json
import sys
from importlib.metadata import version
from pokerkit import Automation, Mode, NoLimitTexasHoldem

VERSION = "0.7.8"
AUTOMATIONS = (
    Automation.ANTE_POSTING, Automation.BET_COLLECTION,
    Automation.BLIND_OR_STRADDLE_POSTING,
    Automation.RUNOUT_COUNT_SELECTION,
    Automation.HOLE_CARDS_SHOWING_OR_MUCKING, Automation.HAND_KILLING,
    Automation.CHIPS_PUSHING, Automation.CHIPS_PULLING,
)


def replay(data):
    if version("pokerkit") != VERSION:
        raise ValueError("PokerKit version mismatch")
    count = data["players"]
    if count not in (2, 6):
        raise ValueError("Supported player counts: 2, 6")
    deck = data["deck"]
    expected = {r + s for r in "23456789TJQKA" for s in "cdhs"}
    if len(deck) != 52 or set(deck) != expected:
        raise ValueError("Deck must contain 52 unique cards")
    stacks = data.get("stacks", [10000] * count)
    if len(stacks) != count or any(type(x) is not int or x <= 0 for x in stacks):
        raise ValueError("Invalid stacks")
    state = NoLimitTexasHoldem.create_state(
        AUTOMATIONS, True, 0, (50, 100), 100, tuple(stacks), count,
        mode=Mode.CASH_GAME,
    )
    cursor = 0
    private = []
    for _ in range(count):
        cards = deck[cursor:cursor + 2]
        private.append(cards)
        state.deal_hole("".join(cards))
        cursor += 2

    def settle():
        nonlocal cursor
        for _ in range(20):
            if not state.status or state.actor_index is not None:
                return
            if state.can_burn_card():
                state.burn_card(deck[cursor])
                cursor += 1
            elif state.can_deal_board():
                n = state.board_dealing_count
                state.deal_board("".join(deck[cursor:cursor + n]))
                cursor += n
            else:
                raise ValueError("Unresolved rule lifecycle")
        raise ValueError("Rule lifecycle limit")

    events = []
    for command in data.get("actions", []):
        settle()
        if not state.status or command["actor"] != state.actor_index:
            raise ValueError("Action does not match current actor")
        street = state.street_index
        kind = command["kind"]
        if kind == "fold":
            state.fold()
        elif kind in ("check", "call"):
            if (state.checking_or_calling_amount == 0) != (kind == "check"):
                raise ValueError("Check/call mismatch")
            state.check_or_call()
        elif kind == "raise":
            state.complete_bet_or_raise_to(command["amount"])
        else:
            raise ValueError("Unknown action")
        events.append({**command, "street": street})
    settle()
    actor = state.actor_index if state.status else None
    legal = []
    if actor is not None:
        if state.can_fold():
            legal.append({"kind": "fold"})
        call = state.checking_or_calling_amount
        legal.append({"kind": "check" if call == 0 else "call", "amount": call})
        if state.can_complete_bet_or_raise_to():
            legal.append({"kind": "raise", "min": state.min_completion_betting_or_raising_to_amount,
                          "max": state.max_completion_betting_or_raising_to_amount})
    return {
        "version": VERSION, "players": count, "actor": actor,
        "street": state.street_index if state.status else 4,
        "board": [repr(c) for c in state.get_board_cards(0)],
        "stacks": state.stacks, "bets": state.bets,
        "active": state.statuses, "pot": state.total_pot_amount,
        "complete": not state.status, "payoffs": state.payoffs,
        "holes": private, "legal": legal, "events": events,
        # PokerKit removes mucked/folded cards; only genuinely tabled cards remain.
        "shown": [next(([repr(c) for c in op.hole_cards] for op in reversed(state.operations)
                         if type(op).__name__ == "HoleCardsShowingOrMucking" and op.player_index == i), [])
                  for i in range(count)] if not state.status else [],
    }


for line in sys.stdin:
    try:
        if len(line) > 131072:
            raise ValueError("Rule request too large")
        request = json.loads(line)
        response = {"id": request["id"], "ok": True, "result": replay(request["input"])}
    except Exception as exc:
        response = {"id": request.get("id") if "request" in locals() else None,
                    "ok": False, "error": str(exc)}
    print(json.dumps(response, separators=(",", ":")), flush=True)
