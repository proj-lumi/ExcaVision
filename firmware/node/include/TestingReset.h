#ifndef TESTING_RESET_H
#define TESTING_RESET_H

// Erases this node's complete NVS state, including role, Wi-Fi, baselines, and
// threshold, then restarts it as a fresh sensor node.
void completeTestingReset();

// Exact very-long-hold / serial `r` action. A Gateway broadcasts the same reset
// to every sensor node before clearing and restarting itself.
void completeUnitReset();

#endif
