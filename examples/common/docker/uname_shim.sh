#!/bin/sh
# Shim for uname inside Docker containers running on a WSL2 host.
#
# Intel/Altera shell scripts (nios2-download, nios2-bsp, etc.) detect WSL2
# by checking if `uname -r` contains "microsoft", then switch to Windows
# (.exe) binaries.  That detection breaks inside Docker on WSL2 because the
# container shares the host kernel name.
#
# Mount this script at /usr/local/bin/uname inside the container so it takes
# priority over /bin/uname, stripping the "microsoft" token from the kernel
# string and making the Altera scripts use their native Linux code paths.
/bin/uname "$@" | sed 's/microsoft/generic/g'
