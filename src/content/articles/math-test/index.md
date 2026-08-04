---
title: Markdown 数学公式压力测试
description: 验证普通 Markdown 中复杂数学公式的构建期渲染
date: 2026-08-03
categories:
  - research
tags:
  - markdown
  - mathjax
  - math
series: site-testing
draft: false
---

本文只使用标准 Markdown 数学分隔符，验证常见与复杂公式能否进入 Astro 的数学处理链。

## 行内公式

质能方程 $E = mc^2$ 是一个行内公式。

## 独立公式

$$
x^2 + y^2 = z^2
$$

## 分式

$$
\frac{a+b}{c+d} = \frac{1}{1 + \frac{x}{y}}
$$

## 上下标

$$
a_{n+1} = a_n^2 + x^{n+1}
$$

## 求和

$$
\sum_{k=1}^{n} k^2 = \frac{n(n+1)(2n+1)}{6}
$$

## 积分

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}
$$

## 根式

$$
\sqrt{x^2+y^2} + \sqrt[3]{a+b}
$$

## bmatrix

$$
A = \begin{bmatrix}
a & b \\
c & d
\end{bmatrix}
$$

## aligned 多行公式

$$
\begin{aligned}
(a+b)^2 &= a^2 + 2ab + b^2 \\
(a-b)^2 &= a^2 - 2ab + b^2 \\
(a+b)(a-b) &= a^2 - b^2
\end{aligned}
$$

## cases 分段函数

$$
f(x) = \begin{cases}
x^2, & x \ge 0 \\
-x, & x < 0
\end{cases}
$$

## 希腊字母

$$
\alpha + \beta + \gamma + \Delta + \theta + \lambda + \mu + \pi + \sigma + \Omega
$$

## 较长公式

$$
\mathcal{L}(\theta) = -\sum_{i=1}^{N}\left[y_i\log\sigma(\theta^{\mathsf T}x_i) + (1-y_i)\log\left(1-\sigma(\theta^{\mathsf T}x_i)\right)\right] + \frac{\lambda}{2}\sum_{j=1}^{m}\theta_j^2
$$
