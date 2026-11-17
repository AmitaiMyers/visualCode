import { describe, expect, it } from "vitest";
import type { SourceFile } from "../model/types";
import { fileId } from "../model/ids";
import { makeFileDiff } from "../diff/unifiedDiff";
import { analyze, lines } from "./fixtures";

/** Block names in a file, outline-style ("Cart", "  Cart.add"). */
function blocks(files: SourceFile[], path: string): string[] {
  const { graph } = analyze(files);
  const out: string[] = [];
  const visit = (id: string, depth: number): void => {
    const node = graph.nodes.get(id)!;
    if (node.symbol !== null) out.push(`${"  ".repeat(depth)}${node.symbol.kind === "section" ? `§${node.symbol.name}` : node.symbol.qualifiedName}`);
    node.childIds.forEach((child) => visit(child, depth + 1));
  };
  graph.nodes.get(fileId(path))!.childIds.forEach((child) => visit(child, 0));
  return out;
}

/** Call edges as "file:Block -> file:Block" with short file names, for readable expectations. */
function calls(files: SourceFile[]): string[] {
  const { graph } = analyze(files);
  const label = (id: string): string => {
    const node = graph.nodes.get(id)!;
    const file = node.path.split("/").pop();
    return node.symbol === null ? `${file}` : `${file}:${node.symbol.kind === "section" ? `§${node.symbol.name}` : node.symbol.qualifiedName}`;
  };
  return graph.edges.filter((edge) => edge.kind === "call").map((edge) => `${label(edge.source)} -> ${label(edge.target)}`);
}

function importEdges(files: SourceFile[]): string[] {
  const { graph } = analyze(files);
  const short = (id: string): string => id.split("/").pop()!;
  return graph.edges.filter((edge) => edge.kind === "import").map((edge) => `${short(edge.source)} -> ${short(edge.target)}`);
}

describe("Java", () => {
  const files: SourceFile[] = [
    {
      path: "src/main/java/com/acme/shop/Cart.java",
      content: lines(
        "package com.acme.shop;",
        "",
        "import com.acme.util.Strings;",
        "",
        "/** A shopping cart. */",
        "public class Cart {",
        "  private final List<Item> items = new ArrayList<>();",
        "",
        "  public void add(Item item) {",
        "    validate(item);",
        "    items.add(item);",
        "    Strings.trim(item.name());",
        "  }",
        "",
        "  private void validate(Item item) {",
        "    if (item == null) throw new IllegalArgumentException();",
        "  }",
        "}",
      ),
    },
    {
      path: "src/main/java/com/acme/util/Strings.java",
      content: lines("package com.acme.util;", "", "public final class Strings {", "  public static String trim(String s) { return s.trim(); }", "}"),
    },
    {
      path: "src/main/java/com/acme/shop/Checkout.java",
      content: lines("package com.acme.shop;", "", "public class Checkout {", "  void run() { Cart cart = new Cart(); }", "}"),
    },
  ];

  it("finds classes and methods, with the Javadoc in the class block", () => {
    expect(blocks(files, files[0]!.path)).toEqual(["§imports", "Cart", "  Cart.add", "  Cart.validate"]);
    expect(analyze(files).graph.nodes.get("sym:src/main/java/com/acme/shop/Cart.java#Cart")!.symbol!.startLine).toBe(5);
  });

  it("resolves implicit this, imports and same-package classes", () => {
    expect(calls(files)).toEqual(
      expect.arrayContaining(["Cart.java:Cart.add -> Cart.java:Cart.validate", "Cart.java:Cart.add -> Strings.java:Strings.trim", "Checkout.java:Checkout.run -> Cart.java:Cart"]),
    );
    expect(importEdges(files)).toEqual(["Cart.java -> Strings.java"]);
  });
});

describe("Kotlin", () => {
  const files: SourceFile[] = [
    {
      path: "app/src/main/kotlin/com/acme/shop/Cart.kt",
      content: lines(
        "package com.acme.shop",
        "",
        "import com.acme.util.formatMoney",
        "",
        "class Cart {",
        "    private val items = mutableListOf<Int>()",
        "",
        "    fun add(item: Int) {",
        "        validate(item)",
        "        items.add(item)",
        "    }",
        "",
        "    fun total(): String = formatMoney(items.sum())",
        "",
        "    private fun validate(item: Int) {",
        "        require(item > 0)",
        "    }",
        "}",
      ),
    },
    { path: "app/src/main/kotlin/com/acme/util/Money.kt", content: lines("package com.acme.util", "", 'fun formatMoney(cents: Int): String = "$" + cents / 100') },
  ];

  it("resolves members and imported top-level functions", () => {
    expect(blocks(files, files[0]!.path)).toEqual(["§imports", "Cart", "  Cart.add", "  Cart.total", "  Cart.validate"]);
    expect(calls(files)).toEqual(expect.arrayContaining(["Cart.kt:Cart.add -> Cart.kt:Cart.validate", "Cart.kt:Cart.total -> Money.kt:formatMoney"]));
    expect(importEdges(files)).toEqual(["Cart.kt -> Money.kt"]);
  });
});

describe("Go", () => {
  const files: SourceFile[] = [
    {
      path: "internal/store/store.go",
      content: lines(
        "package store",
        "",
        "import (",
        '\t"fmt"',
        "",
        '\t"github.com/acme/shop/internal/util"',
        ")",
        "",
        "type Store struct {",
        "\titems []string",
        "}",
        "",
        "func New() *Store {",
        "\treturn &Store{}",
        "}",
        "",
        "func (s *Store) Add(item string) {",
        "\ts.validate(item)",
        "\ts.items = append(s.items, util.Clean(item))",
        "\tfmt.Println(item)",
        "}",
        "",
        "func (s *Store) validate(item string) {",
        '\tif item == "" {',
        '\t\tpanic("empty")',
        "\t}",
        "}",
      ),
    },
    { path: "internal/util/clean.go", content: lines("package util", "", 'import "strings"', "", "func Clean(s string) string {", "\treturn strings.TrimSpace(s)", "}") },
    { path: "internal/store/report.go", content: lines("package store", "", "func Report() int {", "\ts := New()", "\treturn len(s.items)", "}") },
  ];

  it("attaches receiver methods to their struct and resolves packages", () => {
    expect(blocks(files, files[0]!.path)).toEqual(["§imports", "Store", "  Store.Add", "  Store.validate", "New"]);
    expect(calls(files)).toEqual(
      expect.arrayContaining([
        "store.go:New -> store.go:Store",
        "store.go:Store.Add -> store.go:Store.validate",
        "store.go:Store.Add -> clean.go:Clean",
        "report.go:Report -> store.go:New",
      ]),
    );
    expect(importEdges(files)).toEqual(["store.go -> clean.go"]);
  });

  it("maps a diff onto a receiver method", () => {
    const diff = makeFileDiff("internal/store/store.go", null, "modified", lines("@@ -18,1 +18,1 @@", "-\ts.check(item)", "+\ts.validate(item)"));
    expect(analyze(files, [diff]).changes.get("sym:internal/store/store.go#Store.Add")?.status).toBe("modified");
  });
});

describe("C#", () => {
  const files: SourceFile[] = [
    {
      path: "src/Shop/Cart.cs",
      content: lines(
        "using System;",
        "using Acme.Util;",
        "",
        "namespace Acme.Shop",
        "{",
        "    public class Cart",
        "    {",
        "        public void Add(Item item)",
        "        {",
        "            Validate(item);",
        '            Log.Write("added");',
        "        }",
        "",
        "        private void Validate(Item item)",
        "        {",
        "            if (item == null) throw new ArgumentNullException();",
        "        }",
        "    }",
        "}",
      ),
    },
    {
      path: "src/Util/Log.cs",
      content: lines("namespace Acme.Util", "{", "    public static class Log", "    {", "        public static void Write(string message) { Console.WriteLine(message); }", "    }", "}"),
    },
  ];

  it("reads classes inside namespaces and finds types across namespaces by name", () => {
    expect(blocks(files, files[0]!.path)).toEqual(["§imports", "Cart", "  Cart.Add", "  Cart.Validate"]);
    expect(calls(files)).toEqual(expect.arrayContaining(["Cart.cs:Cart.Add -> Cart.cs:Cart.Validate", "Cart.cs:Cart.Add -> Log.cs:Log.Write"]));
  });
});

describe("Rust", () => {
  const files: SourceFile[] = [
    {
      path: "src/main.rs",
      content: lines("mod cart;", "mod util;", "", "use crate::cart::Cart;", "", "fn main() {", "    let mut basket = Cart::new();", "    basket.add(3);", '    util::log("done");', "}"),
    },
    {
      path: "src/cart.rs",
      content: lines(
        "use crate::util;",
        "",
        "/// Items waiting for checkout.",
        "pub struct Cart {",
        "    items: Vec<u32>,",
        "}",
        "",
        "impl Cart {",
        "    pub fn new() -> Self {",
        "        Cart { items: Vec::new() }",
        "    }",
        "",
        "    pub fn add(&mut self, item: u32) {",
        "        self.validate(item);",
        "        self.items.push(item);",
        '        util::log("added");',
        "    }",
        "",
        "    fn validate(&self, item: u32) {",
        "        assert!(item > 0);",
        "    }",
        "}",
      ),
    },
    { path: "src/util.rs", content: lines("pub fn log(message: &str) {", '    println!("{}", message);', "}") },
  ];

  it("merges impl blocks into their struct and leaves no stray impl sections", () => {
    expect(blocks(files, "src/cart.rs")).toEqual(["§imports", "Cart", "  Cart.new", "  Cart.add", "  Cart.validate"]);
  });

  it("resolves use paths, mod declarations and self calls", () => {
    expect(calls(files)).toEqual(
      expect.arrayContaining([
        "main.rs:main -> cart.rs:Cart.new",
        "main.rs:main -> util.rs:log",
        "cart.rs:Cart.add -> cart.rs:Cart.validate",
        "cart.rs:Cart.add -> util.rs:log",
        "cart.rs:Cart.new -> cart.rs:Cart",
      ]),
    );
    expect(importEdges(files).sort()).toEqual(["cart.rs -> util.rs", "main.rs -> cart.rs", "main.rs -> util.rs"]);
  });
});

describe("C and C++", () => {
  const cFiles: SourceFile[] = [
    { path: "src/main.c", content: lines("#include <stdio.h>", '#include "cart.h"', "", "int main(void) {", "    struct cart c = {0};", "    cart_add(&c, 2);", '    printf("%d\\n", c.count);', "    return 0;", "}") },
    { path: "src/cart.h", content: lines("#ifndef CART_H", "#define CART_H", "", "struct cart {", "    int count;", "};", "", "int cart_add(struct cart *c, int item);", "", "#endif") },
    {
      path: "src/cart.c",
      content: lines('#include "cart.h"', "", "static int is_valid(int item) {", "    return item > 0;", "}", "", "int cart_add(struct cart *c, int item) {", "    if (!is_valid(item)) return -1;", "    c->count += item;", "    return 0;", "}"),
    },
  ];

  it("links C functions across files through the shared global namespace", () => {
    expect(blocks(cFiles, "src/cart.c")).toEqual(["§imports", "is_valid", "cart_add"]);
    expect(calls(cFiles)).toEqual(expect.arrayContaining(["main.c:main -> cart.c:cart_add", "cart.c:cart_add -> cart.c:is_valid"]));
    expect(importEdges(cFiles).sort()).toEqual(["cart.c -> cart.h", "main.c -> cart.h"]);
  });

  const cppFiles: SourceFile[] = [
    {
      path: "src/store.hpp",
      content: lines("#pragma once", "#include <string>", "", "namespace shop {", "", "class Store {", " public:", "  void add(const std::string& item);", "  int count() const { return count_; }", "", " private:", "  bool valid(const std::string& item) const;", "  int count_ = 0;", "};", "", "}  // namespace shop"),
    },
    {
      path: "src/store.cpp",
      content: lines('#include "store.hpp"', "", "namespace shop {", "", "void Store::add(const std::string& item) {", "  if (valid(item)) {", "    count_++;", "  }", "}", "", "bool Store::valid(const std::string& item) const {", "  return !item.empty();", "}", "", "}  // namespace shop"),
    },
  ];

  it("reads C++ classes and out-of-line member definitions", () => {
    expect(blocks(cppFiles, "src/store.hpp")).toEqual(["§imports", "Store", "  Store.count"]);
    expect(blocks(cppFiles, "src/store.cpp")).toEqual(["§imports", "Store.add", "Store.valid"]);
    expect(calls(cppFiles)).toEqual(expect.arrayContaining(["store.cpp:Store.add -> store.cpp:Store.valid"]));
    expect(importEdges(cppFiles)).toEqual(["store.cpp -> store.hpp"]);
  });
});

describe("PHP", () => {
  const files: SourceFile[] = [
    {
      path: "src/Shop/Cart.php",
      content: lines(
        "<?php",
        "",
        "namespace App\\Shop;",
        "",
        "use App\\Util\\Money;",
        "",
        "require_once __DIR__ . '/helpers.php';",
        "",
        "class Cart",
        "{",
        "    private array $items = [];",
        "",
        "    public function add(int $price): void",
        "    {",
        "        $this->validate($price);",
        "        $this->items[] = $price;",
        "        log_line(Money::format($price));",
        "    }",
        "",
        "    private function validate(int $price): void",
        "    {",
        "        if ($price <= 0) {",
        "            throw new \\InvalidArgumentException('price');",
        "        }",
        "    }",
        "}",
      ),
    },
    { path: "src/Util/Money.php", content: lines("<?php", "", "namespace App\\Util;", "", "class Money", "{", "    public static function format(int $cents): string", "    {", "        return number_format($cents / 100, 2);", "    }", "}") },
    { path: "src/Shop/helpers.php", content: lines("<?php", "", "function log_line(string $line): void", "{", "    error_log($line);", "}") },
  ];

  it("resolves $this, use statements and required helper files", () => {
    expect(blocks(files, files[0]!.path)).toEqual(["§imports", "Cart", "  Cart.add", "  Cart.validate"]);
    expect(calls(files)).toEqual(
      expect.arrayContaining(["Cart.php:Cart.add -> Cart.php:Cart.validate", "Cart.php:Cart.add -> Money.php:Money.format", "Cart.php:Cart.add -> helpers.php:log_line"]),
    );
    expect(importEdges(files).sort()).toEqual(["Cart.php -> Money.php", "Cart.php -> helpers.php"]);
  });
});

describe("Ruby", () => {
  const files: SourceFile[] = [
    {
      path: "lib/shop/cart.rb",
      content: lines(
        'require_relative "../util/money"',
        "",
        "module Shop",
        "  class Cart",
        "    def initialize",
        "      @items = []",
        "    end",
        "",
        "    def add(price)",
        "      validate(price)",
        "      @items << price",
        "      Util::Money.format(price)",
        "    end",
        "",
        "    private",
        "",
        "    def validate(price)",
        '      raise ArgumentError, "price" unless price.positive?',
        "    end",
        "  end",
        "end",
      ),
    },
    { path: "lib/util/money.rb", content: lines("module Util", "  class Money", "    def self.format(cents)", '      "%.2f" % (cents / 100.0)', "    end", "  end", "end") },
  ];

  it("reads classes inside modules and resolves requires and constants", () => {
    expect(blocks(files, files[0]!.path)).toEqual(["§imports", "Cart", "  Cart.initialize", "  Cart.add", "  Cart.validate"]);
    expect(calls(files)).toEqual(expect.arrayContaining(["cart.rb:Cart.add -> cart.rb:Cart.validate", "cart.rb:Cart.add -> money.rb:Money.format"]));
    expect(importEdges(files)).toEqual(["cart.rb -> money.rb"]);
  });
});

describe("Swift", () => {
  const files: SourceFile[] = [
    {
      path: "Sources/Shop/Cart.swift",
      content: lines(
        "import Foundation",
        "",
        "final class Cart {",
        "    private var items: [Int] = []",
        "",
        "    func add(_ price: Int) {",
        "        validate(price)",
        "        items.append(price)",
        "        print(Money.format(price))",
        "    }",
        "",
        "    private func validate(_ price: Int) {",
        "        precondition(price > 0)",
        "    }",
        "}",
        "",
        "extension Cart {",
        "    func clear() {",
        "        items.removeAll()",
        "        reset()",
        "    }",
        "",
        "    private func reset() {}",
        "}",
      ),
    },
    { path: "Sources/Shop/Money.swift", content: lines("struct Money {", "    static func format(_ cents: Int) -> String {", '        return "\\(cents / 100)"', "    }", "}") },
  ];

  it("merges extensions into their type and finds module types by name", () => {
    expect(blocks(files, files[0]!.path)).toEqual(["§imports", "Cart", "  Cart.add", "  Cart.validate", "  Cart.clear", "  Cart.reset"]);
    expect(calls(files)).toEqual(
      expect.arrayContaining(["Cart.swift:Cart.add -> Cart.swift:Cart.validate", "Cart.swift:Cart.add -> Money.swift:Money.format", "Cart.swift:Cart.clear -> Cart.swift:Cart.reset"]),
    );
  });
});

describe("other languages", () => {
  it("shows unparsed code files as one whole-file block, so their changes stay visible", () => {
    const files: SourceFile[] = [{ path: "scripts/deploy.sh", content: lines("#!/bin/sh", "set -e", "", "npm run build", "rsync -a dist/ host:/srv") }];
    const diff = makeFileDiff("scripts/deploy.sh", null, "modified", lines("@@ -4,1 +4,1 @@", "-npm run compile", "+npm run build"));
    const { graph, changes } = analyze(files, [diff]);
    const block = graph.nodes.get("sym:scripts/deploy.sh#§file")!;
    expect([block.label, block.symbol!.startLine, block.symbol!.endLine]).toEqual(["deploy.sh", 1, 5]);
    expect(changes.get(block.id)?.status).toBe("modified");
  });
});
