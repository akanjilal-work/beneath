"""CLI: python -m beneath_pipeline build <layer|all> [--force] | verify | fetch"""
from __future__ import annotations

import argparse
import sys
import time

from .config import LAYER_ORDER


def _build(layer: str, force: bool) -> None:
    from .layers import coastlines, deposits, gravity, magnetic, places, plates
    mods = {"magnetic": magnetic, "gravity": gravity, "plates": plates, "deposits": deposits, "places": places,
            "coastlines": coastlines}
    t0 = time.time()
    if layer == "gravity":
        mods[layer].build(force=force)
    else:
        mods[layer].build()
    print(f"[{layer}] done in {time.time() - t0:.0f}s")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m beneath_pipeline")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build", help="build one layer or all, then rewrite layers.json")
    b.add_argument("layer", choices=LAYER_ORDER + ["all", "manifest"])
    b.add_argument("--force", action="store_true", help="recompute cached intermediate grids")
    sub.add_parser("verify", help="check outputs against sources")
    args = ap.parse_args(argv)

    if args.cmd == "build":
        layers = LAYER_ORDER if args.layer == "all" else ([] if args.layer == "manifest" else [args.layer])
        for layer in layers:
            _build(layer, args.force)
        from .manifest import write_layers_json
        write_layers_json()
        return 0
    if args.cmd == "verify":
        from .verify import main as verify_main
        return verify_main()
    return 1


if __name__ == "__main__":
    sys.exit(main())
