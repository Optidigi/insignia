# M1-001 source and merge provenance

The owner-supplied `insignia-pr19-rereview-and-m1-001.zip` was extracted to a neutral local handoff. Its archive SHA-256 is `5aa4261fadaf2235dcec8c8921f218f6791b9966d7b7452695e826f5d5711035`; packaged checksum and receipt verification passed before execution. The following files are byte-identical imports from that handoff:

| Imported record | SHA-256 |
|---|---|
| [PR-019R external principal review](PR-019R-principal-review.md) | `fa0600c33c2df1c595251565d35d3a7ce66d11020a55bf0f9d8e9c9816e6197e` |
| [M1 entry decision](M1-ENTRY-DECISION.md) | `e102800489b2521462412ce228cee53dd769dc58711d916c23522df9c63e2d13` |
| [M1-001 prompt](prompts/M1-001-WORKSPACE-AND-BOUNDARIES.md) | `266c738a45b70d143fcc30e2eb302fad123e366c160764872b9fc0cbcb56924b` |
| [Owner launch](M1-001-owner-launch.txt) | `adf2599947a9b20a5c766b3c85e8d92b38f13406483d9b62a3eb3f987fa8ac18` |

Immediately before merge, PR #19 targeted `main`, base/effective merge base was `7222a96ff2b0408d0fbfe0803835d24acfd463b7`, reviewed head was `f267b7b3bfae0090060d4f25aafa23e4c2d3cfb7`, and reviewed tree was `0c80fe0c6b585648f2a3678ef80cf9b543bb0ed2`. The external principal approval and eight named successful workflows covered those exact inputs. Mark-ready changed metadata only. `gh pr merge 19 --merge` produced remote merge `a467afcce5f0324a13fd3bfe647d3543eae159a4`, parents `[7222a96ff2b0408d0fbfe0803835d24acfd463b7, f267b7b3bfae0090060d4f25aafa23e4c2d3cfb7]`, and the approved tree. M1 branch `feat/m1-001-foundation` started from that remote merge. No native approval was claimed.
