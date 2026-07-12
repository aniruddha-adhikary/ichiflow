package ai.ichiflow.core.decision

/**
 * One-way projection compiler: `decision-source` → DMN 1.6 XML (ADR-0027, build plan 2.0). It emits
 * the constructs Phase 2.0 probes — inputData, a BKM with an encapsulated FEEL function, and a boxed
 * Context decision containing an Invocation. The emitted XML is deterministic (stable id derivation,
 * fixed element order) so it is diffable and reproducible. Behavioural equivalence to the
 * hand-authored reference is what the spike asserts — byte-identity is not required.
 */
object DecisionSourceCompiler {

    private const val MODEL_NS = "https://www.omg.org/spec/DMN/20240513/MODEL/"
    private const val FEEL_NS = "https://www.omg.org/spec/DMN/20240513/FEEL/"

    fun compile(src: DecisionSource): String {
        val sb = StringBuilder()
        sb.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
        sb.append("<definitions xmlns=\"").append(MODEL_NS).append("\"")
        sb.append(" xmlns:feel=\"").append(FEEL_NS).append("\"")
        sb.append(" namespace=\"").append(esc(src.namespace)).append("\"")
        sb.append(" id=\"").append(id(src.name)).append("\"")
        sb.append(" name=\"").append(esc(src.name)).append("\">\n")

        for (input in src.inputs) {
            val iid = "id${id(input.name)}"
            sb.append("  <inputData id=\"").append(iid).append("\" name=\"")
                .append(esc(input.name)).append("\">\n")
            sb.append("    <variable name=\"").append(esc(input.name))
                .append("\" typeRef=\"").append(esc(input.type)).append("\"/>\n")
            sb.append("  </inputData>\n")
        }

        for (bkm in src.bkms) {
            sb.append("  <businessKnowledgeModel id=\"bkm").append(id(bkm.name))
                .append("\" name=\"").append(esc(bkm.name)).append("\">\n")
            sb.append("    <variable name=\"").append(esc(bkm.name))
                .append("\" typeRef=\"").append(esc(bkm.type)).append("\"/>\n")
            sb.append("    <encapsulatedLogic>\n")
            for (p in bkm.parameters) {
                sb.append("      <formalParameter name=\"").append(esc(p.name))
                    .append("\" typeRef=\"").append(esc(p.type)).append("\"/>\n")
            }
            sb.append("      <literalExpression>\n        <text>").append(esc(bkm.body))
                .append("</text>\n      </literalExpression>\n")
            sb.append("    </encapsulatedLogic>\n")
            sb.append("  </businessKnowledgeModel>\n")
        }

        val d = src.decision
        sb.append("  <decision id=\"dec").append(id(d.name)).append("\" name=\"")
            .append(esc(d.name)).append("\">\n")
        sb.append("    <variable name=\"").append(esc(d.name))
            .append("\" typeRef=\"").append(esc(d.type)).append("\"/>\n")
        for (req in d.requires) {
            sb.append("    <informationRequirement>\n      <requiredInput href=\"#id")
                .append(id(req)).append("\"/>\n    </informationRequirement>\n")
        }
        for (k in d.knowledge) {
            sb.append("    <knowledgeRequirement>\n      <requiredKnowledge href=\"#bkm")
                .append(id(k)).append("\"/>\n    </knowledgeRequirement>\n")
        }

        sb.append("    <context>\n")
        for (entry in d.context) {
            sb.append("      <contextEntry>\n")
            if (!entry.result) {
                sb.append("        <variable name=\"").append(esc(entry.name!!))
                    .append("\" typeRef=\"").append(esc(entry.type ?: "Any")).append("\"/>\n")
            }
            val invoke = entry.invoke
            if (invoke != null) {
                sb.append("        <invocation>\n")
                sb.append("          <literalExpression>\n            <text>")
                    .append(esc(invoke.bkm)).append("</text>\n          </literalExpression>\n")
                for ((param, expr) in invoke.bindings) {
                    sb.append("          <binding>\n            <parameter name=\"")
                        .append(esc(param)).append("\"/>\n")
                    sb.append("            <literalExpression>\n              <text>")
                        .append(esc(expr)).append("</text>\n            </literalExpression>\n")
                    sb.append("          </binding>\n")
                }
                sb.append("        </invocation>\n")
            } else {
                sb.append("        <literalExpression>\n          <text>")
                    .append(esc(entry.expr ?: error("context entry needs expr or invoke")))
                    .append("</text>\n        </literalExpression>\n")
            }
            sb.append("      </contextEntry>\n")
        }
        sb.append("    </context>\n")
        sb.append("  </decision>\n")
        sb.append("</definitions>\n")
        return sb.toString()
    }

    /** Stable id token: strip everything but alphanumerics (DMN ids must be NCName-safe). */
    private fun id(name: String): String = name.filter { it.isLetterOrDigit() }

    private fun esc(s: String): String =
        s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
}
