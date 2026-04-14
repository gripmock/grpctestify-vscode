module.exports = grammar({
  name: "gctf",

  extras: ($) => [/[ \t\r]/, $.comment],

  rules: {
    source_file: ($) => repeat(choice($.section, $.blank_line)),

    blank_line: () => /\n/,

    comment: () => token(choice(/#[^\n]*/, /\/\/[^\n]*/)),

    section: ($) => seq($.section_header, /\n/, repeat($.section_line)),

    section_header: ($) =>
      seq(
        "---",
        /[ \t]+/,
        field(
          "name",
          choice(
            "META",
            "ADDRESS",
            "ENDPOINT",
            "REQUEST",
            "RESPONSE",
            "ERROR",
            "REQUEST_HEADERS",
            "ASSERTS",
            "EXTRACT",
            "TLS",
            "PROTO",
            "OPTIONS",
            "HEADERS",
          ),
        ),
        optional(
          seq(
            /[ \t]+/,
            field(
              "options",
              repeat1(
                choice(
                  token(choice("with_asserts", "partial", "unordered_arrays")),
                  seq(
                    token(choice("tolerance", "redact")),
                    "=",
                    token(/[0-9.]+|\[[^\]]*\]/),
                  ),
                ),
              ),
            ),
          ),
        ),
        /[ \t]+/,
        "---",
      ),

    section_line: () => /[^\n]*/,
  },
});
