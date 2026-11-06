const TOKEN = "YOUR_GITHUB_PERSONAL_ACCESS_TOKEN";
const headers = {
  "Authorization": `Bearer ${TOKEN}`,
  "Accept": "application/vnd.github+json",
  "User-Agent": "Unfollow-Script"
};

// Helper function to fetch ALL pages of a GitHub endpoint
async function fetchAllPages(baseUrl) {
  let allUsers = [];
  let page = 1;

  while (true) {
    const res = await fetch(`${baseUrl}?per_page=100&page=${page}`, { headers });
    if (!res.ok) {
      throw new Error(`HTTP Error ${res.status} while fetching ${baseUrl}`);
    }
    const data = await res.json();
    if (data.length === 0) break; // No more pages left

    allUsers = allUsers.concat(data);
    page++;
  }
  return allUsers;
}

async function unfollowNonFollowers() {
  try {
    console.log("Fetching ALL following and followers across all pages...");

    const [following, followers] = await Promise.all([
      fetchAllPages("https://api.github.com/user/following"),
      fetchAllPages("https://api.github.com/user/followers")
    ]);

    console.log(`Total Following: ${following.length} | Total Followers: ${followers.length}\n`);

    const followerSet = new Set(followers.map(u => u.login));
    let unfollowedCount = 0;

    for (const user of following) {
      if (!followerSet.has(user.login)) {
        const res = await fetch(`https://api.github.com/user/following/${user.login}`, {
          method: "DELETE",
          headers
        });

        if (res.status === 204) {
          console.log(`[-] Unfollowed: @${user.login}`);
          unfollowedCount++;
        } else {
          console.log(`[!] Failed to unfollow @${user.login} (Status: ${res.status})`);
        }

        // Small 200ms delay so GitHub doesn't rate-limit or block rapid DELETE requests
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    console.log(`\nDone! Unfollowed ${unfollowedCount} user(s) in total.`);
  } catch (err) {
    console.error("Error running script:", err.message);
  }
}

unfollowNonFollowers();
