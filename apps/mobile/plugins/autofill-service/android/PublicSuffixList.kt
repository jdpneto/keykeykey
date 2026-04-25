package com.keykeykey.app

import java.io.InputStream

/**
 * Mozilla Public Suffix List parser + lookup for the Android autofill service.
 *
 * Mirrors the Swift implementation in
 * `apps/mobile/targets/credential-provider/PublicSuffixList.swift` and consumes
 * the same `public_suffix_list.dat` packed file, so eTLD+1 results are
 * bit-identical between iOS and Android. Cross-validated against
 * `packages/core/src/domain/__fixtures__/domain-match.json` (the same fixture
 * the Swift `DomainMatcherRunner` uses).
 *
 * Algorithm (per https://publicsuffix.org/list/):
 *  1. Lowercase the host, split on dots.
 *  2. Walk the rule trie right-to-left, tracking the deepest non-exception
 *     match and the deepest exception match. Wildcards (`*.foo`) consume one
 *     extra label.
 *  3. Exception rules (`!www.ck`) win and shorten the match by one label.
 *  4. If no rule matches, the default is the rightmost label only.
 *  5. The registrable domain is the public suffix plus one label.
 *
 * This class has no Android dependencies; load it via `loadFromStream` from a
 * plain InputStream (the autofill service does this with an AssetManager;
 * tests can pass a FileInputStream).
 */
class PublicSuffixList {

    private class Node {
        val children: MutableMap<String, Node> = mutableMapOf()

        // True if a rule terminates at this node.
        var isRule = false

        // True if the terminating rule is an exception (`!foo.bar`). Exceptions
        // remove their matched labels — the public suffix is one label shorter.
        var isException = false

        // True if a wildcard rule (`*.foo`) lives at this node. Wildcards
        // consume any single label at this trie position.
        var isWildcard = false
    }

    private val root = Node()

    @Volatile
    private var loaded = false
    private val loadLock = Any()

    /**
     * Load PSL rules from an InputStream containing the standard
     * `public_suffix_list.dat` format (one rule per line; `//` comments;
     * anything after the first whitespace on a rule line is also a comment).
     * Idempotent: subsequent calls are no-ops.
     */
    fun loadFromStream(stream: InputStream) {
        synchronized(loadLock) {
            if (loaded) return
            stream.bufferedReader(Charsets.UTF_8).useLines { lines ->
                for (rawLine in lines) {
                    val trimmed = rawLine.trim()
                    if (trimmed.isEmpty()) continue
                    if (trimmed.startsWith("//")) continue
                    val rule = trimmed.split(' ').firstOrNull() ?: trimmed
                    if (rule.isEmpty()) continue
                    insert(rule)
                }
            }
            loaded = true
        }
    }

    fun isLoaded(): Boolean = loaded

    private fun insert(rule: String) {
        var ruleLabels = rule
        val isException = ruleLabels.startsWith("!")
        if (isException) ruleLabels = ruleLabels.substring(1)

        // Trie is indexed right-to-left.
        val labels = ruleLabels.split(".").reversed()
        var node = root
        for (label in labels) {
            if (label == "*") {
                node.isWildcard = true
            } else {
                node = node.children.getOrPut(label) { Node() }
            }
        }
        node.isRule = true
        node.isException = isException
    }

    /**
     * Returns the public suffix (eTLD) for `host`, e.g. "co.uk" for "bob.co.uk".
     * Returns null if PSL data hasn't been loaded or `host` is empty. When no
     * rule matches, applies the PSL default-rule convention and returns the
     * rightmost label only.
     */
    fun effectiveTLD(host: String): String? {
        if (!loaded) return null
        val labels = host.lowercase().split(".").filter { it.isNotEmpty() }
        if (labels.isEmpty()) return null

        var node = root
        var longestMatchDepth = 0
        var exceptionMatchDepth = 0
        var depth = 0

        for (label in labels.reversed()) {
            val child = node.children[label]
            if (child != null) {
                node = child
                depth += 1
                if (node.isRule) {
                    if (node.isException) {
                        exceptionMatchDepth = depth
                    } else {
                        longestMatchDepth = depth
                    }
                }
            } else if (node.isWildcard) {
                // Wildcard consumes one more label.
                depth += 1
                longestMatchDepth = depth
                break
            } else {
                break
            }
        }

        val matchDepth: Int =
            when {
                exceptionMatchDepth > 0 -> exceptionMatchDepth - 1
                longestMatchDepth > 0 -> longestMatchDepth
                else -> 1 // default rule: rightmost label
            }

        if (matchDepth <= 0 || matchDepth > labels.size) return null
        return labels.takeLast(matchDepth).joinToString(".")
    }

    /**
     * Returns the registrable domain (eTLD+1) for `host`, e.g. "bob.co.uk" for
     * "login.bob.co.uk". Returns null when the host IS the public suffix
     * (e.g. "co.uk" itself), has no extra label, or the PSL hasn't loaded.
     */
    fun registrableDomain(host: String): String? {
        val etld = effectiveTLD(host) ?: return null
        val hostLower = host.lowercase()
        if (hostLower == etld) return null
        val labels = hostLower.split(".").filter { it.isNotEmpty() }
        val etldLabels = etld.split(".").size
        if (labels.size <= etldLabels) return null
        return labels.takeLast(etldLabels + 1).joinToString(".")
    }
}
