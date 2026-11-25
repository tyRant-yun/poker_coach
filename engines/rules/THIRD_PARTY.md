# Rules dependency

PokerKit 0.7.8 is installed from its published Python wheel, pinned in requirements.txt.
Upstream: https://github.com/uoftcprg/pokerkit
Documentation: https://pokerkit.readthedocs.io/en/stable/
License: MIT; the installed distribution includes its license. Preserve that license in any bundled distribution.

The Riverline helper is a thin adapter over PokerKit's NLHE state machine. It does not implement betting, side-pot, showdown or hand-ranking algorithms. Python 3.14 is the locally exercised interpreter for this integration; Python 3.13 and packaged runtimes require their own validation.
