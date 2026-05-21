# DMAX SSE helpers for Nushell.
# Mirrors the small subset of the Datastar helpers used by this example.

export def "to dmax-patch-elements" [
  --selector: string
  --mode: string = "outer"
  --namespace: string
  --id: string
  --retry-duration: int
]: any -> record {
  let input = $in
  let type = $input | describe -d | get type
  let html = match $type {
    "string" => $input
    "record" => (if "__html" in $input { $input.__html } else { error make {msg: "record must have __html field"} })
    _ => (error make {msg: $"expected string or {__html} record, got ($type)"})
  }
  let data = [
    (if $selector != null { $"selector ($selector)" })
    (if $mode != "outer" { $"mode ($mode)" })
    (if $namespace != null { $"namespace ($namespace)" })
    ...($html | lines | each { $"dmaxElements ($in)" })
  ] | compact

  {event: "dmax-patch-elements" data: $data id: $id retry: $retry_duration}
}

export def "to dmax-patch-signals" [
  --only-if-missing
  --id: string
  --retry-duration: int
]: any -> record {
  let input = $in
  let json_str = match ($input | describe -d | get type) {
    "string" => $input
    _ => ($input | to json --raw)
  }
  let data = [
    (if $only_if_missing { "onlyIfMissing true" })
    ...($json_str | lines | each { $"dmaxSignals ($in)" })
  ] | compact

  {event: "dmax-patch-signals" data: $data id: $id retry: $retry_duration}
}

export def "from dmax-signals" [req: record]: string -> record {
  match $req.method {
    "GET" | "DELETE" => (try { $req.query.dmax? | default "{}" | from json } catch { {} })
    _ => (try { $in | from json } catch { {} })
  }
}
