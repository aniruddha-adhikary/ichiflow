package ai.ichiflow.core.decision

/**
 * One-way projection compiler: `decision-source` → DMN 1.6 XML (ADR-0027, build plan 2.0/2.2). It
 * emits the DMN feature matrix — inputData, BKMs (encapsulated FEEL functions), and decisions whose
 * logic is any boxed-expression kind: literalExpression, decisionTable (any hit policy), boxed
 * context, invocation, list, relation — wired by information/knowledge requirements. The emitted XML
 * is deterministic (stable id derivation, fixed element order) so it is diffable and reproducible.
 * Behavioural equivalence on the reference engine is what the harness asserts — byte-identity is not
 * required. This projector is engine-free (ArchUnit `decision-source.pure-projection`): it never
 * touches `org.kie`/`org.drools`.
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
        src.inputs.forEach { emitInput(sb, it) }
        src.bkms.forEach { emitBkm(sb, it) }
        src.allDecisions().forEach { emitDecision(sb, it) }
        sb.append("</definitions>\n")
        return sb.toString()
    }

    private fun emitInput(sb: StringBuilder, input: InputDef) {
        val iid = "id${id(input.name)}"
        sb.append("  <inputData id=\"").append(iid).append("\" name=\"")
            .append(esc(input.name)).append("\">\n")
        sb.append("    <variable name=\"").append(esc(input.name))
            .append("\" typeRef=\"").append(esc(input.type)).append("\"/>\n")
        sb.append("  </inputData>\n")
    }

    private fun emitBkm(sb: StringBuilder, bkm: BkmDef) {
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

    private fun emitDecision(sb: StringBuilder, d: DecisionDef) {
        sb.append("  <decision id=\"dec").append(id(d.name)).append("\" name=\"")
            .append(esc(d.name)).append("\">\n")
        sb.append("    <variable name=\"").append(esc(d.name))
            .append("\" typeRef=\"").append(esc(d.type)).append("\"/>\n")
        emitRequirements(sb, d)
        emitLogic(sb, d)
        sb.append("  </decision>\n")
    }

    private fun emitRequirements(sb: StringBuilder, d: DecisionDef) {
        for (req in d.requires) {
            sb.append("    <informationRequirement>\n      <requiredInput href=\"#id")
                .append(id(req)).append("\"/>\n    </informationRequirement>\n")
        }
        for (req in d.requiresDecisions) {
            sb.append("    <informationRequirement>\n      <requiredDecision href=\"#dec")
                .append(id(req)).append("\"/>\n    </informationRequirement>\n")
        }
        for (k in d.knowledge) {
            sb.append("    <knowledgeRequirement>\n      <requiredKnowledge href=\"#bkm")
                .append(id(k)).append("\"/>\n    </knowledgeRequirement>\n")
        }
    }

    private fun emitLogic(sb: StringBuilder, d: DecisionDef) {
        when {
            d.literal != null -> emitLiteral(sb, d.literal)
            d.decisionTable != null -> emitDecisionTable(sb, d.decisionTable, d.type)
            d.invoke != null -> emitInvocation(sb, d.invoke)
            d.list != null -> emitList(sb, d.list)
            d.relation != null -> emitRelation(sb, d.relation)
            d.context.isNotEmpty() -> emitContext(sb, d.context)
            else -> error("decision ${d.name} has no logic body")
        }
    }

    private fun emitLiteral(sb: StringBuilder, expr: String) {
        sb.append("    <literalExpression>\n      <text>").append(esc(expr))
            .append("</text>\n    </literalExpression>\n")
    }

    private fun emitContext(sb: StringBuilder, entries: List<ContextEntryDef>) {
        sb.append("    <context>\n")
        entries.forEach { emitContextEntry(sb, it) }
        sb.append("    </context>\n")
    }

    private fun emitContextEntry(sb: StringBuilder, entry: ContextEntryDef) {
        sb.append("      <contextEntry>\n")
        if (!entry.result) {
            sb.append("        <variable name=\"").append(esc(entry.name!!))
                .append("\" typeRef=\"").append(esc(entry.type ?: "Any")).append("\"/>\n")
        }
        val invoke = entry.invoke
        if (invoke != null) {
            emitInvocation(sb, invoke, indent = "        ")
        } else {
            sb.append("        <literalExpression>\n          <text>")
                .append(esc(entry.expr ?: error("context entry needs expr or invoke")))
                .append("</text>\n        </literalExpression>\n")
        }
        sb.append("      </contextEntry>\n")
    }

    private fun emitInvocation(sb: StringBuilder, invoke: InvokeDef, indent: String = "    ") {
        sb.append(indent).append("<invocation>\n")
        sb.append(indent).append("  <literalExpression>\n").append(indent).append("    <text>")
            .append(esc(invoke.bkm)).append("</text>\n").append(indent).append("  </literalExpression>\n")
        for ((param, expr) in invoke.bindings) {
            sb.append(indent).append("  <binding>\n").append(indent).append("    <parameter name=\"")
                .append(esc(param)).append("\"/>\n")
            sb.append(indent).append("    <literalExpression>\n").append(indent).append("      <text>")
                .append(esc(expr)).append("</text>\n").append(indent).append("    </literalExpression>\n")
            sb.append(indent).append("  </binding>\n")
        }
        sb.append(indent).append("</invocation>\n")
    }

    private fun emitDecisionTable(sb: StringBuilder, dt: DecisionTableDef, outputType: String) {
        sb.append("    <decisionTable hitPolicy=\"").append(esc(dt.hitPolicy)).append("\">\n")
        for (input in dt.inputs) {
            sb.append("      <input>\n        <inputExpression typeRef=\"").append(esc(input.type))
                .append("\">\n          <text>").append(esc(input.expr))
                .append("</text>\n        </inputExpression>\n      </input>\n")
        }
        sb.append("      <output typeRef=\"").append(esc(dt.output.type)).append("\"/>\n")
        for (rule in dt.rules) {
            sb.append("      <rule>\n")
            for (test in rule.whenTests) {
                sb.append("        <inputEntry>\n          <text>").append(esc(test))
                    .append("</text>\n        </inputEntry>\n")
            }
            sb.append("        <outputEntry>\n          <text>").append(esc(rule.then))
                .append("</text>\n        </outputEntry>\n      </rule>\n")
        }
        sb.append("    </decisionTable>\n")
        // outputType is carried by the decision variable; kept engine-neutral here.
        require(outputType.isNotEmpty())
    }

    private fun emitList(sb: StringBuilder, items: List<String>) {
        sb.append("    <list>\n")
        for (item in items) {
            sb.append("      <literalExpression>\n        <text>").append(esc(item))
                .append("</text>\n      </literalExpression>\n")
        }
        sb.append("    </list>\n")
    }

    private fun emitRelation(sb: StringBuilder, rel: RelationDef) {
        sb.append("    <relation>\n")
        for (col in rel.columns) {
            sb.append("      <column name=\"").append(esc(col)).append("\"/>\n")
        }
        for (row in rel.rows) {
            sb.append("      <row>\n")
            for (cell in row) {
                sb.append("        <literalExpression>\n          <text>").append(esc(cell))
                    .append("</text>\n        </literalExpression>\n")
            }
            sb.append("      </row>\n")
        }
        sb.append("    </relation>\n")
    }

    /** Stable id token: strip everything but alphanumerics (DMN ids must be NCName-safe). */
    private fun id(name: String): String = name.filter { it.isLetterOrDigit() }

    private fun esc(s: String): String =
        s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
}
